// Email sending via Resend
import { Resend } from "resend";
import { logger } from "./logger.js";

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

const emailHtml = (magicUrl: string) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Sign in to EnviroIQ</title></head>
<body style="font-family:system-ui,sans-serif;background:#f9fafb;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="margin-bottom:24px;">
      <span style="color:#16a34a;font-weight:700;font-size:20px;">EnviroIQ</span>
    </div>
    <h1 style="font-size:22px;font-weight:700;color:#111827;margin:0 0 12px;">Sign in to your account</h1>
    <p style="color:#6b7280;margin:0 0 24px;font-size:15px;">Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
    <a href="${magicUrl}" style="display:inline-block;background:#16a34a;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:15px;">Sign in to EnviroIQ</a>
    <p style="color:#9ca3af;margin-top:24px;font-size:12px;">If you didn't request this, you can safely ignore it. The link expires automatically.</p>
  </div>
</body>
</html>`;

export async function sendMagicLinkEmail(
  to: string,
  magicUrl: string,
): Promise<{ sent: boolean; devMode: boolean }> {
  const resend = await getResendClient();

  if (resend) {
    const { data, error } = await resend.client.emails.send({
      from: resend.from,
      to,
      subject: "Sign in to EnviroIQ",
      html: emailHtml(magicUrl),
      text: `Sign in to EnviroIQ\n\nClick this link to sign in (expires in 15 minutes):\n${magicUrl}\n\nIf you didn't request this, ignore this email.`,
    });

    if (error) {
      logger.error({ error, to }, "Resend failed to send magic link email");
      throw new Error(`Email send failed: ${error.message}`);
    }

    logger.info({ to, messageId: data?.id }, "Magic link email sent via Resend");
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
