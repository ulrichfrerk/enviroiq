// Email sending via Replit Resend integration
import { Resend } from "resend";
import { logger } from "./logger.js";

// Resend integration — credentials fetched fresh per-send (tokens expire)
async function getResendClient(): Promise<{ client: Resend; from: string } | null> {
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

    const from = process.env.FROM_EMAIL || settings.from_email || "EnviroIQ <noreply@enviroiq.net>";
    return { client: new Resend(settings.api_key), from };
  } catch (err) {
    logger.warn({ err }, "Failed to fetch Resend credentials");
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
