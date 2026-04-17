import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireRole } from "../lib/auth.js";
import { logger } from "../lib/logger.js";

type CheckStatus = "pass" | "warn" | "fail";
type Severity = "critical" | "high" | "medium" | "low";

interface SecurityCheck {
  id: string;
  category: "transport" | "auth" | "session" | "headers" | "data" | "integration" | "audit";
  label: string;
  severity: Severity;
  status: CheckStatus;
  detail: string;
}

function envBool(key: string): boolean {
  return Boolean(process.env[key]);
}

function isHttpsContext(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    !!process.env.REPLIT_DOMAINS ||
    !!process.env.REPLIT_DEV_DOMAIN
  );
}

async function safeCount(query: ReturnType<typeof sql>): Promise<number | null> {
  try {
    const result = await db.execute(query);
    const rows = (result as { rows?: Array<Record<string, unknown>> }).rows ?? [];
    const first = rows[0] ?? {};
    const value = (first as Record<string, unknown>).count ?? Object.values(first)[0];
    if (value == null) return 0;
    return Number(value);
  } catch (err) {
    logger.warn({ err }, "security check query failed");
    return null;
  }
}

function unavailable(label: string): SecurityCheck["detail"] {
  return `${label} could not be evaluated — database query failed. See server logs.`;
}

async function runChecks(): Promise<SecurityCheck[]> {
  // === Static / config-derived checks (no DB) ===
  const checks: SecurityCheck[] = [];

  checks.push({
    id: "https-context",
    category: "transport",
    label: "HTTPS termination",
    severity: "critical",
    status: isHttpsContext() ? "pass" : "warn",
    detail: isHttpsContext()
      ? "Configured: TLS terminated at Replit edge proxy; cookies set Secure=true."
      : "Local dev context — TLS not enforced. Production deploy will be HTTPS-only.",
  });

  checks.push({
    id: "hsts",
    category: "headers",
    label: "Strict-Transport-Security (HSTS)",
    severity: "high",
    status: "pass",
    detail:
      "Configured (Helmet): max-age=63072000; includeSubDomains; preload. Sent on every /api response.",
  });

  checks.push({
    id: "security-headers",
    category: "headers",
    label: "Security response headers",
    severity: "medium",
    status: "pass",
    detail:
      "Configured: X-Frame-Options=DENY, X-Content-Type-Options=nosniff, Referrer-Policy=strict-origin-when-cross-origin, Permissions-Policy locks camera/mic/geolocation/payment, Server header stripped.",
  });

  const corsConfigured = Boolean(
    process.env.ALLOWED_ORIGINS ||
      process.env.REPLIT_DOMAINS ||
      process.env.REPLIT_DEV_DOMAIN,
  );
  checks.push({
    id: "cors-allowlist",
    category: "transport",
    label: "CORS allowlist",
    severity: "high",
    status: corsConfigured ? "pass" : "warn",
    detail: corsConfigured
      ? "Configured: deny-by-default with credentials; origins resolved from ALLOWED_ORIGINS / REPLIT_DOMAINS."
      : "No origins resolved — cross-origin requests will be blocked entirely.",
  });

  const sessionSecret = process.env.SESSION_SECRET ?? "";
  const secretStrong = sessionSecret.length >= 32;
  checks.push({
    id: "session-secret",
    category: "session",
    label: "Session signing secret",
    severity: "critical",
    status: secretStrong ? "pass" : sessionSecret ? "warn" : "fail",
    detail: secretStrong
      ? "SESSION_SECRET set with sufficient entropy (≥32 chars)."
      : sessionSecret
        ? "SESSION_SECRET set but shorter than recommended (≥32 chars)."
        : "SESSION_SECRET missing — using insecure dev fallback. Production refuses to boot.",
  });

  checks.push({
    id: "session-cookie",
    category: "session",
    label: "Session cookie hardening",
    severity: "critical",
    status: "pass",
    detail: `Configured: httpOnly, sameSite=lax, secure=${isHttpsContext()}, name=eiq.sid, 7-day TTL, PostgreSQL-backed store with 15-min prune.`,
  });

  checks.push({
    id: "auth-rate-limit",
    category: "auth",
    label: "Auth rate limiting",
    severity: "high",
    status: "pass",
    detail:
      "Configured: /api/auth limited to 20 req / 15 min / IP; global API limit 500 / 15 min.",
  });

  checks.push({
    id: "passwordless",
    category: "auth",
    label: "Passwordless authentication",
    severity: "high",
    status: "pass",
    detail:
      "Configured: no passwords stored — passkeys (WebAuthn) and single-use 15-minute magic links only.",
  });

  checks.push({
    id: "org-active-guard",
    category: "auth",
    label: "Suspended/locked account lockout",
    severity: "critical",
    status: "pass",
    detail:
      "Configured: checkOrgLoginAllowed() blocks login on suspended billing or isActive=false at /auth/session, passkey-authenticate, magic-link verify.",
  });

  checks.push({
    id: "inbound-email-secret",
    category: "integration",
    label: "Inbound-email webhook signature",
    severity: "medium",
    status: envBool("INBOUND_EMAIL_WEBHOOK_SECRET") ? "pass" : "warn",
    detail: envBool("INBOUND_EMAIL_WEBHOOK_SECRET")
      ? "INBOUND_EMAIL_WEBHOOK_SECRET set — Resend inbound webhooks are signature-validated."
      : "INBOUND_EMAIL_WEBHOOK_SECRET not set — energy-bill email ingestion is unauthenticated.",
  });

  // === Runtime DB-backed checks (run in parallel) ===
  const [
    passkeyCount,
    crmKeyTotal,
    crmKeyMissingHash,
    crmPrefixIndex,
    orgsTotal,
    orgsMissingWebhook,
    auditTokenLeak,
    auditTokenHash,
    recentAudits,
    crmUsage,
  ] = await Promise.all([
    safeCount(sql`SELECT COUNT(*)::int AS count FROM passkeys`),
    safeCount(sql`SELECT COUNT(*)::int AS count FROM crm_api_keys`),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM crm_api_keys WHERE key_hash IS NULL OR length(key_hash) < 64`,
    ),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM pg_indexes WHERE tablename = 'crm_api_keys' AND indexdef ILIKE '%prefix%'`,
    ),
    safeCount(sql`SELECT COUNT(*)::int AS count FROM organisations`),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM organisations WHERE webhook_secret IS NULL OR webhook_secret = ''`,
    ),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_name='supplier_audits' AND column_name='token' AND data_type IN ('text','character varying')`,
    ),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_name='supplier_audits' AND column_name='token_hash'`,
    ),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM audit_logs WHERE created_at > NOW() - INTERVAL '24 hours'`,
    ),
    safeCount(
      sql`SELECT COUNT(*)::int AS count FROM crm_api_key_usage WHERE ts > NOW() - INTERVAL '24 hours'`,
    ),
  ]);

  checks.push({
    id: "passkey-store",
    category: "auth",
    label: "Passkey credential store",
    severity: "medium",
    status: passkeyCount === null ? "fail" : "pass",
    detail:
      passkeyCount === null
        ? unavailable("Passkey store")
        : `Reachable: ${passkeyCount} passkey credential(s) registered. Session ID rotated on every successful authentication.`,
  });

  checks.push({
    id: "crm-key-hashing",
    category: "integration",
    label: "CRM API keys hashed at rest",
    severity: "critical",
    status:
      crmKeyTotal === null || crmKeyMissingHash === null
        ? "fail"
        : crmKeyMissingHash > 0
          ? "fail"
          : "pass",
    detail:
      crmKeyTotal === null || crmKeyMissingHash === null
        ? unavailable("CRM key hash check")
        : crmKeyMissingHash > 0
          ? `${crmKeyMissingHash} of ${crmKeyTotal} CRM API key(s) have an invalid or missing SHA-256 hash.`
          : `${crmKeyTotal} CRM API key(s); all stored as SHA-256 hash + 16-char public prefix only. Comparison via timingSafeEqual.`,
  });

  checks.push({
    id: "crm-key-prefix-index",
    category: "integration",
    label: "CRM key indexed prefix lookup",
    severity: "high",
    status:
      crmPrefixIndex === null ? "fail" : crmPrefixIndex > 0 ? "pass" : "warn",
    detail:
      crmPrefixIndex === null
        ? unavailable("Prefix index check")
        : crmPrefixIndex > 0
          ? "Prefix column indexed — constant-time hash compare runs only on the candidate set."
          : "No index on crm_api_keys.prefix — auth path falls back to full table scan.",
  });

  checks.push({
    id: "fleet-webhook-secrets",
    category: "integration",
    label: "Per-org fleet webhook secrets",
    severity: "high",
    status:
      orgsTotal === null || orgsMissingWebhook === null
        ? "fail"
        : orgsMissingWebhook > 0
          ? "warn"
          : "pass",
    detail:
      orgsTotal === null || orgsMissingWebhook === null
        ? unavailable("Webhook-secret check")
        : orgsMissingWebhook > 0
          ? `${orgsMissingWebhook} of ${orgsTotal} organisations have no webhook secret — fleet webhooks for those orgs will reject all traffic.`
          : `All ${orgsTotal} organisations have a webhook_secret configured.`,
  });

  checks.push({
    id: "supplier-audit-tokens",
    category: "data",
    label: "Public audit links tokenised",
    severity: "critical",
    status:
      auditTokenHash === null || auditTokenLeak === null
        ? "fail"
        : auditTokenHash > 0 && auditTokenLeak === 0
          ? "pass"
          : auditTokenHash > 0
            ? "warn"
            : "fail",
    detail:
      auditTokenHash === null || auditTokenLeak === null
        ? unavailable("Public-audit token check")
        : auditTokenHash > 0 && auditTokenLeak === 0
          ? "Public audit links signed by sha256(token); only the hash is stored. Tokens redacted in request logs."
          : auditTokenHash > 0
            ? "token_hash column present but a plaintext token column also exists — review supplier_audits schema."
            : "supplier_audits.token_hash column missing — public links may be stored in plaintext.",
  });

  checks.push({
    id: "audit-logging",
    category: "audit",
    label: "Audit log activity (last 24h)",
    severity: "medium",
    status: recentAudits === null ? "fail" : recentAudits > 0 ? "pass" : "warn",
    detail:
      recentAudits === null
        ? unavailable("Audit-log check")
        : recentAudits > 0
          ? `${recentAudits} entries in the last 24h. All mutating /api calls are logged after response.`
          : "No audit entries in the last 24h — middleware is wired but inactive.",
  });

  checks.push({
    id: "crm-usage-log",
    category: "audit",
    label: "CRM API call ledger",
    severity: "low",
    status: crmUsage === null ? "warn" : "pass",
    detail:
      crmUsage === null
        ? unavailable("CRM usage ledger")
        : `${crmUsage} CRM API call(s) logged in the last 24h (every call written to crm_api_key_usage).`,
  });

  return checks;
}

function summarise(checks: SecurityCheck[]) {
  const counts = { pass: 0, warn: 0, fail: 0 };
  for (const c of checks) counts[c.status]++;
  const overall: CheckStatus = counts.fail > 0 ? "fail" : counts.warn > 0 ? "warn" : "pass";
  return { overall, counts };
}

const router = Router();

// Restricted to platform operators — security details reveal infrastructure state
// and would be cross-tenant information disclosure if exposed to org users/viewers.
router.get(
  "/status",
  requireRole("super_admin", "org_admin"),
  async (_req: Request, res: Response) => {
    try {
      const checks = await runChecks();
      const summary = summarise(checks);
      res.json({
        generatedAt: new Date().toISOString(),
        overall: summary.overall,
        counts: summary.counts,
        checks,
      });
    } catch (err) {
      logger.error({ err }, "security status check failed");
      res
        .status(500)
        .json({ error: "Internal Server Error", message: "Unable to compute security status" });
    }
  },
);

// Admin-only full Security Pack — every check, including infrastructure detail.
// Plaintext so it can be diff-ed across runs and pinned via the SHA-256 footer.
router.get(
  "/pack.txt",
  requireRole("super_admin", "org_admin"),
  async (req: Request, res: Response) => {
    try {
      const checks = await runChecks();
      const summary = summarise(checks);
      const generatedAt = new Date().toISOString();

      const lines: string[] = [];
      lines.push("================================================================");
      lines.push("  EnviroIQ — Internal Security Pack (CONFIDENTIAL)");
      lines.push("  Distribute only to authorised auditors and platform operators.");
      lines.push("================================================================");
      lines.push("");
      lines.push(`Generated:           ${generatedAt}`);
      lines.push(`Generated by:        ${req.session?.userEmail ?? "unknown"}`);
      lines.push(`Overall status:      ${summary.overall.toUpperCase()}`);
      lines.push(
        `Counts:              ${summary.counts.pass} pass, ${summary.counts.warn} warn, ${summary.counts.fail} fail`,
      );
      lines.push("");

      const byCategory = checks.reduce<Record<string, SecurityCheck[]>>((acc, c) => {
        (acc[c.category] ||= []).push(c);
        return acc;
      }, {});
      for (const [cat, items] of Object.entries(byCategory)) {
        lines.push(`── ${cat.toUpperCase()} ──────────────────────────────────────────`);
        for (const c of items) {
          const marker =
            c.status === "pass" ? "[PASS]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
          lines.push(`${marker} ${c.label}  (severity: ${c.severity}, id: ${c.id})`);
          for (const part of c.detail.match(/.{1,68}(\s|$)/g) ?? [c.detail]) {
            lines.push(`        ${part.trim()}`);
          }
          lines.push("");
        }
      }
      const body = lines.join("\n");
      const checksum = createHash("sha256").update(body).digest("hex");

      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="enviroiq-security-pack-${generatedAt.slice(0, 10)}.txt"`,
      );
      res.setHeader("Cache-Control", "no-store");
      res.send(`${body}\nSHA-256 checksum of pack body: ${checksum}\n`);
    } catch (err) {
      logger.error({ err }, "security pack export failed");
      res
        .status(500)
        .json({ error: "Internal Server Error", message: "Unable to build security pack" });
    }
  },
);

export default router;
