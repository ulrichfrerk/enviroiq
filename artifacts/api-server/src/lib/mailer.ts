import nodemailer from "nodemailer";
import { logger } from "./logger.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM;

  if (!smtpHost || !smtpUser || !smtpPass || !smtpFrom) {
    return null;
  }

  transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  return transporter;
}

export async function sendMagicLinkEmail(to: string, magicUrl: string): Promise<{ sent: boolean; devMode: boolean }> {
  const smtp = getTransporter();
  const from = process.env.SMTP_FROM || "noreply@enviroiq.app";

  const html = `<!DOCTYPE html>
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

  const text = `Sign in to EnviroIQ\n\nClick this link to sign in (expires in 15 minutes):\n${magicUrl}\n\nIf you didn't request this, ignore this email.`;

  if (smtp) {
    try {
      await smtp.sendMail({ from, to, subject: "Sign in to EnviroIQ", html, text });
      logger.info({ to }, "Magic link email sent");
      return { sent: true, devMode: false };
    } catch (err) {
      logger.error({ err, to }, "Failed to send magic link email via SMTP");
      throw err;
    }
  }

  // SMTP not configured — log to console in dev, warn in production
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.log(`\n[MAGIC LINK - EMAIL NOT CONFIGURED]\n  To: ${to}\n  URL: ${magicUrl}\n  Configure SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_FROM to send real emails.\n`);
    return { sent: false, devMode: true };
  }

  // In production without SMTP: throw so the caller can return a meaningful error
  throw new Error("SMTP not configured — cannot send magic link email in production");
}
