// Email sending via Resend
import { Resend } from "resend";
import { logger } from "./logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Beta recipient allowlist
// ─────────────────────────────────────────────────────────────────────────────
// While EnviroIQ notifications are in beta we want to be able to limit
// "system-generated" emails (daily digests, scheduled reminders, security
// digests) to a small list of internal addresses without touching the
// generation/scheduling pipeline. Set NOTIFICATION_BETA_ALLOWLIST to a
// comma-separated list of email addresses (case-insensitive) to enable.
//
// Auth-flow emails (magic links, invites, supplier-audit *invites*) are
// NEVER filtered — they would silently break sign-in for real users.
function getBetaAllowlist(): Set<string> | null {
  const raw = process.env.NOTIFICATION_BETA_ALLOWLIST;
  if (!raw || !raw.trim()) return null;
  const set = new Set(
    raw
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  return set.size > 0 ? set : null;
}

/** Returns true when the recipient is allowed to receive beta-gated mail. */
function recipientAllowed(to: string, allowlist: Set<string> | null): boolean {
  if (!allowlist) return true;
  return allowlist.has(to.trim().toLowerCase());
}

// Resend client — prefers RESEND_API_KEY secret (works in dev + production),
// falls back to the Replit Connectors proxy for legacy compatibility.
async function getResendClient(): Promise<{ client: Resend; from: string } | null> {
  const from = process.env.FROM_EMAIL || "EnviroIQ <noreply@enviroiq.net>";

  // Primary: direct API key secret (most reliable across all environments)
  if (process.env.RESEND_API_KEY) {
    return { client: new Resend(process.env.RESEND_API_KEY), from };
  }

  // Fallback: Replit Connectors proxy
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    return null;
  }

  try {
    const data = await fetch(
      `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
      {
        headers: {
          Accept: "application/json",
          "X-Replit-Token": xReplitToken,
        },
      },
    ).then((res) => res.json()) as { items?: Array<{ settings?: { api_key?: string; from_email?: string } }> };

    const settings = data?.items?.[0]?.settings;
    if (!settings?.api_key) return null;

    const connectorFrom = process.env.FROM_EMAIL || settings.from_email || from;
    return { client: new Resend(settings.api_key), from: connectorFrom };
  } catch (err) {
    logger.warn({ err }, "Failed to fetch Resend credentials from connector proxy");
    return null;
  }
}

const inviteEmailHtml = (name: string, orgName: string, magicUrl: string) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>You've been invited to EnviroIQ</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;">
      <span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px;">Welcome to EnviroIQ, ${name}!</h1>
    <p style="color:#6b7280;margin:0 0 12px;font-size:15px;">You've been set up as the <strong>Organisation Administrator</strong> for <strong>${orgName}</strong> on EnviroIQ — the real-time ESG intelligence platform.</p>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;">Click the button below to get started. This link expires in 24 hours and can only be used once.</p>
    <a href="${magicUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Get Started →</a>
    <p style="color:#9ca3af;margin-top:24px;font-size:12px;">If you weren't expecting this invitation, you can safely ignore this email.</p>
  </div>
</body>
</html>`;

export async function sendInviteEmail(
  to: string,
  name: string,
  orgName: string,
  magicUrl: string,
): Promise<{ sent: boolean; devMode: boolean }> {
  const resend = await getResendClient();

  if (resend) {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      subject: `You've been invited to EnviroIQ — ${orgName}`,
      html: inviteEmailHtml(name, orgName, magicUrl),
      text: `Welcome to EnviroIQ, ${name}!\n\nYou've been set up as the Organisation Administrator for ${orgName}.\n\nClick this link to get started (expires in 24 hours):\n${magicUrl}\n\nIf you weren't expecting this invitation, you can safely ignore this email.`,
    });

    if (error) {
      logger.error({ error, to }, "Resend failed to send invite email");
      throw new Error(`Invite email send failed: ${error.message}`);
    }

    logger.info({ to, messageId: data?.id }, "Invite email sent via Resend");
    return { sent: true, devMode: false };
  }

  if (process.env.NODE_ENV !== "production") {
    console.log(`\n[INVITE EMAIL — RESEND NOT CONFIGURED]\n  To: ${to}\n  URL: ${magicUrl}\n`);
    return { sent: false, devMode: true };
  }

  throw new Error("Resend not configured — cannot send invite email in production");
}

// Visual reference code derived from the magic-link token. Purely for the
// recipient to confirm "this is the same email I just triggered" when they
// have multiple sign-in requests in flight. Not used for verification on the
// server side — the token in the URL is still what's authoritative.
function deriveReferenceCode(magicUrl: string): string {
  try {
    const u = new URL(magicUrl);
    const token = u.searchParams.get("token") ?? magicUrl;
    const clean = token.replace(/[^a-zA-Z0-9]/g, "");
    const tail = clean.slice(-6).toUpperCase();
    return tail.length === 6 ? `${tail.slice(0, 3)}-${tail.slice(3)}` : tail || "------";
  } catch {
    return "------";
  }
}

const REPLY_TO = process.env.SUPPORT_REPLY_TO || "support@enviroiq.net";
const COMPANY_NAME = process.env.COMPANY_LEGAL_NAME || "EnviroIQ";
const COMPANY_ADDRESS = process.env.COMPANY_POSTAL_ADDRESS || "Auckland, New Zealand";

const emailHtml = (to: string, magicUrl: string, refCode: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your EnviroIQ sign-in link</title>
</head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#f4f6f8;margin:0;padding:32px 16px;color:#111827;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:36px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:20px;">
      <span style="color:#16a34a;font-weight:700;font-size:20px;letter-spacing:-0.01em;">EnviroIQ</span>
      <span style="color:#9ca3af;font-size:13px;margin-left:8px;">ESG Intelligence Platform</span>
    </div>

    <h1 style="font-size:20px;font-weight:600;color:#111827;margin:0 0 8px;line-height:1.35;">Your sign-in link is ready</h1>
    <p style="color:#374151;margin:0 0 20px;font-size:14px;line-height:1.55;">
      Hi — you (or someone using <strong style="color:#111827;">${escapeHtml(to)}</strong>) just requested to sign in to EnviroIQ.
      Click the button below to continue. This link expires in <strong>15 minutes</strong> and can only be used once.
    </p>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td>
      <a href="${magicUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Sign in to EnviroIQ</a>
    </td></tr></table>

    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin:0 0 20px;">
      <div style="color:#6b7280;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.04em;">Reference code</div>
      <div style="color:#111827;font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:18px;font-weight:600;letter-spacing:0.08em;">${refCode}</div>
      <div style="color:#6b7280;font-size:12px;margin-top:6px;">Use this to confirm the link you click matches the one we sent.</div>
    </div>

    <p style="color:#6b7280;margin:0 0 8px;font-size:13px;line-height:1.55;">
      <strong style="color:#374151;">Didn't request this?</strong>
      You can safely ignore this email — the link will expire and no one can access your account without it.
      If you keep getting these, reply to this email and we'll help.
    </p>

    <p style="color:#9ca3af;margin-top:24px;padding-top:18px;border-top:1px solid #f3f4f6;font-size:11px;line-height:1.55;">
      Sent by ${escapeHtml(COMPANY_NAME)} • ${escapeHtml(COMPANY_ADDRESS)}<br>
      Questions? Reply to this email or contact <a href="mailto:${escapeHtml(REPLY_TO)}" style="color:#16a34a;text-decoration:none;">${escapeHtml(REPLY_TO)}</a><br>
      This is a transactional sign-in email and is not promotional.
    </p>
  </div>
</body>
</html>`;

const emailText = (to: string, magicUrl: string, refCode: string) =>
  `EnviroIQ — Your sign-in link is ready

You (or someone using ${to}) just requested to sign in to EnviroIQ.

Open this link in your browser to sign in (expires in 15 minutes,
single-use):

${magicUrl}

Reference code: ${refCode}
(Use this to confirm the link matches what we sent.)

Didn't request this? Ignore this email — the link will expire and no
one can access your account without it. If these keep arriving, reply
to this email and we'll help.

—
${COMPANY_NAME} • ${COMPANY_ADDRESS}
Questions? ${REPLY_TO}
Transactional sign-in email — not promotional.`;

export async function sendMagicLinkEmail(
  to: string,
  magicUrl: string,
): Promise<{ sent: boolean; devMode: boolean }> {
  const resend = await getResendClient();
  const refCode = deriveReferenceCode(magicUrl);

  if (resend) {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      replyTo: REPLY_TO,
      subject: `Your EnviroIQ sign-in link (code ${refCode}, expires in 15 min)`,
      html: emailHtml(to, magicUrl, refCode),
      text: emailText(to, magicUrl, refCode),
      headers: {
        "X-Entity-Ref-ID": refCode,
        "Auto-Submitted": "auto-generated",
      },
    });

    if (error) {
      logger.error({ error, to }, "Resend failed to send magic link email");
      throw new Error(`Email send failed: ${error.message}`);
    }

    logger.info({ to, messageId: data?.id, refCode }, "Magic link email sent via Resend");
    return { sent: true, devMode: false };
  }

  // Resend not available — fall back to console in dev, fail in production
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(
      `\n[MAGIC LINK — RESEND NOT CONFIGURED]\n  To: ${to}\n  URL: ${magicUrl}\n`,
    );
    return { sent: false, devMode: true };
  }

  throw new Error("Resend not configured — cannot send magic link email in production");
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification emails (data quality / ingest failure alerts)
// ─────────────────────────────────────────────────────────────────────────────

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

interface DigestItem {
  title: string;
  body: string;
  linkUrl?: string;
}

const renderDigestItems = (items: DigestItem[], appBase: string): string => {
  return items
    .map((it) => {
      const href = it.linkUrl
        ? (it.linkUrl.startsWith("http") ? it.linkUrl : `${appBase}${it.linkUrl}`)
        : "";
      const cta = href
        ? `<div style="margin-top:10px;"><a href="${escapeHtml(href)}" style="color:#16a34a;font-weight:600;font-size:13px;text-decoration:none;">Open in EnviroIQ →</a></div>`
        : "";
      return `
      <div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px 18px;margin:0 0 12px;background:#fafafa;">
        <div style="font-weight:600;color:#111827;font-size:15px;margin:0 0 6px;line-height:1.35;">${escapeHtml(it.title)}</div>
        <div style="color:#4b5563;font-size:14px;line-height:1.55;">${escapeHtml(it.body).replace(/\n/g, "<br>")}</div>
        ${cta}
      </div>`;
    })
    .join("");
};

const notificationEmailHtml = (
  recipientName: string,
  orgName: string,
  title: string,
  body: string,
  linkUrl?: string,
  items?: DigestItem[],
) => {
  const appBase = process.env.APP_BASE_URL?.replace(/\/$/, "") ?? "https://enviroiq.net";
  const intro = items && items.length > 0
    ? `<p style="color:#374151;margin:0 0 18px;font-size:14px;line-height:1.55;">${escapeHtml(body)}</p>${renderDigestItems(items, appBase)}`
    : `<div style="color:#374151;margin:0 0 20px;font-size:14px;line-height:1.6;">${escapeHtml(body).replace(/\n/g, "<br>")}</div>`;
  const cta = linkUrl && (!items || items.length === 0)
    ? `<a href="${escapeHtml(linkUrl)}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;margin-top:8px;">Open in EnviroIQ →</a>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;color:#111827;">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:36px 36px 32px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;display:flex;align-items:baseline;gap:10px;">
      <span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span>
      <span style="color:#6b7280;font-size:13px;">${escapeHtml(orgName)}</span>
    </div>
    <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 4px;line-height:1.3;">${escapeHtml(title)}</h1>
    <p style="color:#6b7280;margin:0 0 20px;font-size:13px;">Hi ${escapeHtml(recipientName)},</p>
    ${intro}
    ${cta}
    <p style="color:#9ca3af;margin-top:28px;padding-top:20px;border-top:1px solid #f3f4f6;font-size:12px;line-height:1.5;">You're receiving this because you're an organisation administrator on EnviroIQ. Open the bell icon in the app to see the full notification history.</p>
  </div>
</body>
</html>`;
};

const renderDigestText = (items: DigestItem[]): string =>
  items.map((it) => `• ${it.title}\n  ${it.body.replace(/\n/g, "\n  ")}${it.linkUrl ? `\n  Link: ${it.linkUrl}` : ""}`).join("\n\n");

export interface NotificationEmailItem {
  to: string;
  recipientName: string;
  orgName: string;
  title: string;
  body: string;
  linkUrl?: string;
  /** When provided, the email body is rendered as a structured list of items
   *  rather than a single text block. `body` becomes the intro paragraph. */
  items?: DigestItem[];
}

/**
 * Send a batch of notification emails via Resend's batch endpoint (≤100/call).
 * Returns a per-item `results` array in input order; `ok:true` only when
 * Resend confirmed dispatch. Never throws.
 */
export async function sendNotificationEmailBatch(
  items: NotificationEmailItem[],
): Promise<{ sent: number; devMode: boolean; results: Array<{ ok: boolean; error?: string }> }> {
  if (items.length === 0) return { sent: 0, devMode: false, results: [] };
  const results: Array<{ ok: boolean; error?: string }> = items.map(() => ({ ok: false }));

  // Beta gate: silently drop recipients not on the allowlist (still mark them
  // as "ok" so the scheduler stamps the source notification rows as delivered
  // and doesn't keep retrying them every hour).
  const allowlist = getBetaAllowlist();
  const sendIndices: number[] = [];
  const sendItems: NotificationEmailItem[] = [];
  for (let i = 0; i < items.length; i++) {
    if (recipientAllowed(items[i].to, allowlist)) {
      sendIndices.push(i);
      sendItems.push(items[i]);
    } else {
      results[i] = { ok: true, error: "beta_allowlist_filtered" };
    }
  }
  if (allowlist && sendItems.length < items.length) {
    logger.info(
      { dropped: items.length - sendItems.length, kept: sendItems.length, allowlistSize: allowlist.size },
      "Notification batch filtered by NOTIFICATION_BETA_ALLOWLIST",
    );
  }
  if (sendItems.length === 0) return { sent: 0, devMode: false, results };

  const renderText = (item: NotificationEmailItem): string => {
    const intro = `${item.title}\n\nHi ${item.recipientName},\n\n${item.body}`;
    const list = item.items && item.items.length > 0 ? `\n\n${renderDigestText(item.items)}` : "";
    const link = item.linkUrl && (!item.items || item.items.length === 0)
      ? `\n\nOpen in EnviroIQ: ${item.linkUrl}\n` : "";
    return `${intro}${list}${link}`;
  };

  const resend = await getResendClient();
  if (resend) {
    // Chunk to Resend's 100-email batch limit (operate on filtered sendItems).
    let totalSent = 0;
    for (let i = 0; i < sendItems.length; i += 100) {
      const chunk = sendItems.slice(i, i + 100);
      const idxChunk = sendIndices.slice(i, i + 100);
      const payload = chunk.map((item) => ({
        from: resend.from,
        to: item.to,
        subject: `[${item.orgName}] ${item.title}`,
        html: notificationEmailHtml(item.recipientName, item.orgName, item.title, item.body, item.linkUrl, item.items),
        text: renderText(item),
      }));
      try {
        const { data, error } = await resend.client.batch.send(payload);
        if (error) {
          logger.error({ error, count: chunk.length }, "Resend batch failed");
          for (let j = 0; j < chunk.length; j++) results[idxChunk[j]] = { ok: false, error: error.message };
          continue;
        }
        const ids = Array.isArray(data?.data) ? (data.data as Array<{ id?: string }>) : [];
        for (let j = 0; j < chunk.length; j++) {
          if (ids[j]?.id) {
            results[idxChunk[j]] = { ok: true };
            totalSent += 1;
          } else {
            results[idxChunk[j]] = { ok: false, error: "no_id_returned" };
          }
        }
        logger.info({ count: ids.length, batchIds: ids.map((d) => d.id) }, "Notification emails sent via Resend batch");
      } catch (err) {
        logger.error({ err, count: chunk.length }, "Resend batch send threw");
        for (let j = 0; j < chunk.length; j++) results[idxChunk[j]] = { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { sent: totalSent, devMode: false, results };
  }
  if (process.env.NODE_ENV !== "production") {
    for (const item of sendItems) {
      // eslint-disable-next-line no-console
      console.log(`\n[NOTIFICATION EMAIL — RESEND NOT CONFIGURED]\n  To: ${item.to}\n  Subject: [${item.orgName}] ${item.title}\n  Body: ${item.body}\n`);
    }
    return { sent: 0, devMode: true, results };
  }
  logger.error({ count: sendItems.length }, "Resend not configured in production — notification batch dropped");
  return { sent: 0, devMode: false, results };
}

/** Single-recipient notification email. Logs to console in dev, never throws. */
export async function sendNotificationEmail(
  to: string,
  recipientName: string,
  orgName: string,
  title: string,
  body: string,
  linkUrl?: string,
): Promise<{ sent: boolean; devMode: boolean }> {
  // Beta gate.
  const allowlist = getBetaAllowlist();
  if (!recipientAllowed(to, allowlist)) {
    logger.info({ to, title }, "Notification email skipped by NOTIFICATION_BETA_ALLOWLIST");
    return { sent: false, devMode: false };
  }
  const resend = await getResendClient();
  if (resend) {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      subject: `[${orgName}] ${title}`,
      html: notificationEmailHtml(recipientName, orgName, title, body, linkUrl),
      text: `${title}\n\nHi ${recipientName},\n\n${body}\n${linkUrl ? `\nOpen in EnviroIQ: ${linkUrl}\n` : ""}`,
    });
    if (error) {
      logger.error({ error, to }, "Resend failed to send notification email");
      throw new Error(`Notification email send failed: ${error.message}`);
    }
    logger.info({ to, messageId: data?.id, title }, "Notification email sent via Resend");
    return { sent: true, devMode: false };
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`\n[NOTIFICATION EMAIL — RESEND NOT CONFIGURED]\n  To: ${to}\n  Subject: [${orgName}] ${title}\n  Body: ${body}\n`);
    return { sent: false, devMode: true };
  }
  logger.error({ to, title }, "Resend not configured in production — notification email dropped");
  return { sent: false, devMode: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supplier ESG Audit emails
// ─────────────────────────────────────────────────────────────────────────────

const supplierAuditHtml = (
  supplierName: string,
  orgName: string,
  auditUrl: string,
  dueDate: string,
) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${orgName} — Supplier ESG Audit</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;"><span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span></div>
    <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px;">${orgName} requests your annual ESG audit</h1>
    <p style="color:#374151;margin:0 0 12px;font-size:15px;">Hi ${supplierName || "team"},</p>
    <p style="color:#374151;margin:0 0 12px;font-size:15px;">As part of <strong>${orgName}</strong>'s supplier assurance programme, please complete the EnviroIQ Supplier ESG Audit. The questionnaire takes about 20-30 minutes and you can save your progress at any time.</p>
    <p style="color:#374151;margin:0 0 24px;font-size:15px;">Audit due by <strong>${dueDate}</strong>.</p>
    <a href="${auditUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;">Start Audit →</a>
    <p style="color:#6b7280;margin:24px 0 0;font-size:13px;">Or paste this link into your browser:<br><a href="${auditUrl}" style="color:#16a34a;word-break:break-all;">${auditUrl}</a></p>
    <p style="color:#9ca3af;margin-top:24px;font-size:12px;">This link is unique to your organisation. Once submitted, the audit is locked for record-keeping.</p>
  </div>
</body></html>`;

export async function sendSupplierAuditInviteEmail(
  to: string,
  supplierName: string,
  orgName: string,
  auditUrl: string,
  dueDate: string,
): Promise<{ sent: boolean; devMode: boolean }> {
  const resend = await getResendClient();
  if (resend) {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      subject: `${orgName} — Supplier ESG audit (due ${dueDate})`,
      html: supplierAuditHtml(supplierName, orgName, auditUrl, dueDate),
      text: `${orgName} requests your annual ESG audit.\n\nDue: ${dueDate}\n\nStart audit: ${auditUrl}`,
    });
    if (error) {
      logger.error({ error, to }, "Resend failed to send supplier audit invite");
      throw new Error(`Supplier audit invite send failed: ${error.message}`);
    }
    logger.info({ to, messageId: data?.id }, "Supplier audit invite sent via Resend");
    return { sent: true, devMode: false };
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`\n[SUPPLIER AUDIT INVITE — RESEND NOT CONFIGURED]\n  To: ${to}\n  URL: ${auditUrl}\n`);
    return { sent: false, devMode: true };
  }
  throw new Error("Resend not configured — cannot send supplier audit invite in production");
}

const supplierReminderHtml = (
  orgName: string,
  auditUrl: string,
  dueDate: string,
  reminderType: "30d" | "7d" | "overdue",
) => {
  const headline = reminderType === "overdue"
    ? `Your ESG audit for ${orgName} is overdue`
    : reminderType === "7d"
      ? `Reminder: ${orgName} ESG audit due in 7 days`
      : `Reminder: ${orgName} ESG audit due in 30 days`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${headline}</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;"><span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span></div>
    <h1 style="font-size:20px;font-weight:700;color:${reminderType === "overdue" ? "#b91c1c" : "#111827"};margin:0 0 12px;">${headline}</h1>
    <p style="color:#374151;margin:0 0 24px;font-size:15px;">Due: <strong>${dueDate}</strong></p>
    <a href="${auditUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Open Audit →</a>
  </div>
</body></html>`;
};

export async function sendSupplierAuditReminderEmail(
  to: string,
  orgName: string,
  auditUrl: string,
  dueDate: string,
  reminderType: "30d" | "7d" | "overdue",
): Promise<{ sent: boolean; devMode: boolean }> {
  // Beta gate: scheduled reminders are suppressed for non-allowlisted recipients.
  const allowlist = getBetaAllowlist();
  if (!recipientAllowed(to, allowlist)) {
    logger.info({ to, reminderType }, "Supplier audit reminder skipped by NOTIFICATION_BETA_ALLOWLIST");
    return { sent: false, devMode: false };
  }
  const resend = await getResendClient();
  if (resend) {
    const subject = reminderType === "overdue"
      ? `OVERDUE: ${orgName} supplier ESG audit`
      : `Reminder: ${orgName} supplier ESG audit (due ${dueDate})`;
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      subject,
      html: supplierReminderHtml(orgName, auditUrl, dueDate, reminderType),
      text: `${subject}\n\n${auditUrl}`,
    });
    if (error) throw new Error(`Reminder send failed: ${error.message}`);
    logger.info({ to, messageId: data?.id, reminderType }, "Supplier audit reminder sent");
    return { sent: true, devMode: false };
  }
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n[SUPPLIER REMINDER — RESEND NOT CONFIGURED]\n  Type: ${reminderType}\n  To: ${to}\n  URL: ${auditUrl}\n`);
    return { sent: false, devMode: true };
  }
  throw new Error("Resend not configured — cannot send supplier reminder in production");
}

const supplierPortalHtml = (magicUrl: string) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Sign in to your supplier portal</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;"><span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span></div>
    <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 12px;">Sign in to your supplier portal</h1>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;">Click below to sign in. The link expires in 30 minutes.</p>
    <a href="${magicUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Sign in</a>
  </div>
</body></html>`;

// ─────────────────────────────────────────────────────────────────────────────
// Stale sign-in methods digest
// ─────────────────────────────────────────────────────────────────────────────

export interface StaleSignInMethodItem {
  /** Human-readable label, e.g. "Passkey: MacBook Pro" or "Google account user@example.com". */
  label: string;
  /** "Last used Mar 14, 2026" / "Never used". */
  lastUsedLabel: string;
  /** Whole days since last use (or since enrolment if never used). */
  ageDays: number;
}

const staleSignInDigestHtml = (
  recipientName: string,
  items: StaleSignInMethodItem[],
  accountUrl: string,
) => {
  const rows = items
    .map(
      (it) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:14px;">${it.label}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;">${it.lastUsedLabel} (${it.ageDays} days ago)</td>
      </tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Stale sign-in methods on your EnviroIQ account</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;">
      <span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span>
    </div>
    <h1 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 12px;">You have ${items.length} sign-in method${items.length === 1 ? "" : "s"} you haven't used recently</h1>
    <p style="color:#374151;margin:0 0 16px;font-size:14px;">Hi ${recipientName},</p>
    <p style="color:#374151;margin:0 0 20px;font-size:14px;line-height:1.6;">As part of keeping your account secure, we flag passkeys and linked single-sign-on accounts that haven't been used in 90 days or more. If you don't recognise one — or you simply don't need it any more — remove it from your Account page.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 24px;">
      <thead>
        <tr>
          <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:0.04em;">Sign-in method</th>
          <th style="padding:10px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-size:12px;text-align:left;text-transform:uppercase;letter-spacing:0.04em;">Last used</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <a href="${accountUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Review &amp; remove →</a>
    <p style="color:#9ca3af;margin-top:32px;font-size:12px;">You're receiving this because at least one passkey or linked account on your EnviroIQ profile hasn't been used in over 90 days. We send this digest at most once per month.</p>
  </div>
</body>
</html>`;
};

/**
 * Sends a "stale sign-in methods" digest to a single user. Lists every
 * passkey / SSO identity that has been unused for 90+ days, and links to
 * the Account page so they can prune them. Never throws — returns a
 * structured result for the scheduler to log + audit.
 */
export async function sendStaleSignInMethodsEmail(
  to: string,
  recipientName: string,
  items: StaleSignInMethodItem[],
  accountUrl: string,
): Promise<{ sent: boolean; devMode: boolean; messageId?: string }> {
  if (items.length === 0) return { sent: false, devMode: false };
  // Beta gate.
  const allowlist = getBetaAllowlist();
  if (!recipientAllowed(to, allowlist)) {
    logger.info({ to, count: items.length }, "Stale sign-in digest skipped by NOTIFICATION_BETA_ALLOWLIST");
    return { sent: false, devMode: false };
  }
  const resend = await getResendClient();
  const summary = items
    .map((it) => `• ${it.label} — ${it.lastUsedLabel} (${it.ageDays} days ago)`)
    .join("\n");
  const subject = `Review ${items.length} unused sign-in method${items.length === 1 ? "" : "s"} on your EnviroIQ account`;
  if (resend) {
    try {
      const { data, error } = await resend.client.emails.send({
        from: resend.from,
        to,
        subject,
        html: staleSignInDigestHtml(recipientName, items, accountUrl),
        text: `Hi ${recipientName},\n\nThe following sign-in methods on your EnviroIQ account haven't been used in 90 days or more:\n\n${summary}\n\nIf you don't need them, remove them from your Account page:\n${accountUrl}\n\nWe send this digest at most once per month.`,
      });
      if (error) {
        logger.error({ error, to }, "Resend failed to send stale sign-in digest");
        return { sent: false, devMode: false };
      }
      logger.info({ to, messageId: data?.id, count: items.length }, "Stale sign-in digest sent via Resend");
      return { sent: true, devMode: false, messageId: data?.id };
    } catch (err) {
      logger.error({ err, to }, "Resend threw while sending stale sign-in digest");
      return { sent: false, devMode: false };
    }
  }
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`\n[STALE SIGN-IN DIGEST — RESEND NOT CONFIGURED]\n  To: ${to}\n  Subject: ${subject}\n  Body:\n${summary}\n  Account URL: ${accountUrl}\n`);
    return { sent: false, devMode: true };
  }
  logger.error({ to }, "Resend not configured in production — stale sign-in digest dropped");
  return { sent: false, devMode: false };
}

export async function sendSupplierPortalMagicLink(
  to: string,
  magicUrl: string,
): Promise<{ sent: boolean; devMode: boolean }> {
  const resend = await getResendClient();
  if (resend) {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      subject: "Sign in to your EnviroIQ supplier portal",
      html: supplierPortalHtml(magicUrl),
      text: `Sign in to your EnviroIQ supplier portal:\n${magicUrl}\n\nThis link expires in 30 minutes.`,
    });
    if (error) throw new Error(`Portal magic link send failed: ${error.message}`);
    logger.info({ to, messageId: data?.id }, "Supplier portal magic link sent");
    return { sent: true, devMode: false };
  }
  if (process.env.NODE_ENV !== "production") {
    console.log(`\n[SUPPLIER PORTAL LINK — RESEND NOT CONFIGURED]\n  To: ${to}\n  URL: ${magicUrl}\n`);
    return { sent: false, devMode: true };
  }
  throw new Error("Resend not configured — cannot send supplier portal link in production");
}
