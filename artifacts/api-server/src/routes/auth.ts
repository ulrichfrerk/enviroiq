import { Router } from "express";
import {
  db,
  usersTable,
  passkeysTable,
  magicLinksTable,
  webAuthnChallengesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
type AuthenticatorTransportFuture = "ble" | "cable" | "hybrid" | "internal" | "nfc" | "smart-card" | "usb";
import { logAudit } from "../lib/audit.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";

const router = Router();

const RP_NAME = "EnviroIQ";

// Derive WebAuthn RP_ID and ORIGIN dynamically per-request so the same server
// binary works on enviroiq.net (production) and the Replit dev domain simultaneously.
// Explicit env vars always win (production deployment sets RP_ID + ORIGIN).
// Fallback: extract from the browser's Origin request header — the browser always
// sends the exact origin it is running on, so this is safe and correct.
function getWebAuthnConfig(req: import("express").Request): { rpId: string; origin: string } {
  if (process.env.RP_ID && process.env.ORIGIN) {
    return { rpId: process.env.RP_ID, origin: process.env.ORIGIN };
  }

  const rawOrigin = req.headers.origin as string | undefined;
  if (rawOrigin) {
    try {
      const url = new URL(rawOrigin);
      return { rpId: url.hostname, origin: rawOrigin };
    } catch {
      // fall through to env-based defaults below
    }
  }

  // Last-resort fallback using server-known domains (dev only)
  const replitDev = process.env.REPLIT_DEV_DOMAIN;
  const replitApp = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  const fallbackHost =
    process.env.RP_ID ||
    (replitApp ? replitApp.replace(/^https?:\/\//, "") : null) ||
    (replitDev ? replitDev.replace(/^https?:\/\//, "") : null) ||
    "localhost";
  const fallbackOrigin =
    process.env.ORIGIN ||
    (replitApp ? `https://${fallbackHost}` : null) ||
    (replitDev ? `https://${fallbackHost}` : null) ||
    "http://localhost";

  return { rpId: fallbackHost, origin: fallbackOrigin };
}

// GET /auth/session
// Always reads role, org, and active status from the DB so that role changes
// (e.g. elevation to super_admin) take effect immediately without requiring
// the user to log out and back in.
router.get("/session", async (req, res) => {
  const session = req.session;
  if (!session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Not authenticated" });
    return;
  }
  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, session.userId) });
    if (!user || !user.isActive) {
      req.session.destroy(() => {});
      res.status(401).json({ error: "Unauthorized", message: "Not authenticated" });
      return;
    }
    // Keep session in sync so middleware (requireOrgAdmin etc.) also sees the fresh role
    session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    session.organisationId = user.organisationId ?? undefined;
    session.name = user.name;
    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisationId: user.organisationId,
      organisationName: session.organisationName,
      isAuthenticated: true,
    });
  } catch (err) {
    req.log.error({ err }, "Session DB lookup failed");
    // Fall back to session data rather than breaking the user's session
    res.json({
      userId: session.userId,
      email: session.email,
      name: session.name,
      role: session.role,
      organisationId: session.organisationId,
      isAuthenticated: true,
    });
  }
});

// POST /auth/passkey/register/begin
router.post("/passkey/register/begin", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      res.status(400).json({ error: "Bad Request", message: "Email is required" });
      return;
    }

    const existingUser = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });

    // If an account already exists for this email, require proof of ownership:
    // either an active authenticated session for this email, or email verified via magic link
    if (existingUser) {
      const session = req.session;
      const isAuthenticated = session.userId === existingUser.id;
      const emailVerified = session.verifiedEmail === email || session.email === email;
      if (!isAuthenticated && !emailVerified) {
        await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
        res.status(403).json({
          error: "Forbidden",
          message: "Email ownership must be verified before adding a passkey to an existing account. Please sign in with a magic link first.",
        });
        return;
      }
    }

    let user = existingUser;
    if (!user) {
      const id = uuidv4();
      const [newUser] = await db
        .insert(usersTable)
        .values({ id, email, name: name || email, role: "org_viewer" })
        .returning();
      user = newUser;
    }

    const existingPasskeys = await db.query.passkeysTable.findMany({
      where: eq(passkeysTable.userId, user.id),
    });

    const { rpId, origin: _originReg } = getWebAuthnConfig(req);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId,
      userName: user.email,
      userDisplayName: user.name,
      userID: Buffer.from(user.id),
      attestationType: "none",
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: ((pk.transports?.split(",") ?? []) as AuthenticatorTransportFuture[]) || [],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    const challengeId = uuidv4();
    await db.insert(webAuthnChallengesTable).values({
      id: challengeId,
      challenge: options.challenge,
      email,
      type: "registration",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    req.session.webAuthnChallengeId = challengeId;

    res.json(options);
  } catch (err) {
    req.log.error({ err }, "Passkey registration begin failed");
    res.status(500).json({ error: "Internal Server Error", message: "Registration failed" });
  }
});

// POST /auth/passkey/register/complete
router.post("/passkey/register/complete", async (req, res) => {
  try {
    const { credential, email } = req.body;
    if (!credential || !email) {
      res.status(400).json({ error: "Bad Request", message: "Credential and email required" });
      return;
    }

    const challengeId = req.session.webAuthnChallengeId;
    if (!challengeId) {
      await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
      res.status(400).json({ error: "Bad Request", message: "No active registration challenge for this session" });
      return;
    }

    const challengeRecord = await db.query.webAuthnChallengesTable.findFirst({
      where: eq(webAuthnChallengesTable.id, challengeId),
    });

    if (!challengeRecord || challengeRecord.expiresAt < new Date() || challengeRecord.type !== "registration") {
      await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
      res.status(400).json({ error: "Bad Request", message: "Challenge expired or not found" });
      return;
    }

    // Verify the email on the challenge matches the email in the request to prevent
    // credential hijacking (attaching a passkey to a different account)
    if (challengeRecord.email !== email) {
      await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
      res.status(400).json({ error: "Bad Request", message: "Email mismatch for this registration challenge" });
      return;
    }

    const { rpId: rpIdReg, origin: originReg } = getWebAuthnConfig(req);
    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: originReg,
      expectedRPID: rpIdReg,
    });

    if (!verification.verified || !verification.registrationInfo) {
      await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
      res.status(400).json({ error: "Verification Failed", message: "Passkey verification failed" });
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (!user) {
      await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
      res.status(400).json({ error: "Bad Request", message: "User not found" });
      return;
    }

    const { credential: cred } = verification.registrationInfo;
    await db.insert(passkeysTable).values({
      id: uuidv4(),
      userId: user.id,
      credentialId: cred.id,
      credentialPublicKey: Buffer.from(cred.publicKey).toString("base64"),
      counter: cred.counter.toString(),
      deviceType: verification.registrationInfo.credentialDeviceType,
      backedUp: verification.registrationInfo.credentialBackedUp,
      transports: (credential.response?.transports || []).join(","),
    });

    await db.delete(webAuthnChallengesTable).where(eq(webAuthnChallengesTable.id, challengeRecord.id));

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    // Regenerate session ID to prevent session fixation after privilege transition
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    const session = req.session;
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    session.organisationId = user.organisationId;

    await logAudit({ req, action: "passkey.register", outcome: "success", userId: user.id, userEmail: email });

    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisationId: user.organisationId,
      isAuthenticated: true,
    });
  } catch (err) {
    req.log.error({ err }, "Passkey registration complete failed");
    res.status(500).json({ error: "Internal Server Error", message: "Registration failed" });
  }
});

// POST /auth/passkey/authenticate/begin
router.post("/passkey/authenticate/begin", async (req, res) => {
  try {
    const { email } = req.body || {};

    let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] = [];
    if (email) {
      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
      if (user) {
        const passkeys = await db.query.passkeysTable.findMany({
          where: eq(passkeysTable.userId, user.id),
        });
        allowCredentials = passkeys.map((pk) => ({
          id: pk.credentialId,
          transports: ((pk.transports?.split(",") ?? []) as AuthenticatorTransportFuture[]) || [],
        }));
      }
    }

    const { rpId: rpIdAuth } = getWebAuthnConfig(req);
    const options = await generateAuthenticationOptions({
      rpID: rpIdAuth,
      allowCredentials,
      userVerification: "preferred",
    });

    const challengeId = uuidv4();
    await db.insert(webAuthnChallengesTable).values({
      id: challengeId,
      challenge: options.challenge,
      email: email || null,
      type: "authentication",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    req.session.webAuthnChallengeId = challengeId;

    res.json(options);
  } catch (err) {
    req.log.error({ err }, "Passkey auth begin failed");
    res.status(500).json({ error: "Internal Server Error", message: "Authentication failed" });
  }
});

// POST /auth/passkey/authenticate/complete
router.post("/passkey/authenticate/complete", async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      res.status(400).json({ error: "Bad Request", message: "Credential required" });
      return;
    }

    const challengeId = req.session.webAuthnChallengeId;
    if (!challengeId) {
      await logAudit({ req, action: "passkey.authenticate", outcome: "failure" });
      res.status(400).json({ error: "Bad Request", message: "No active authentication challenge for this session" });
      return;
    }

    const challengeRecord = await db.query.webAuthnChallengesTable.findFirst({
      where: eq(webAuthnChallengesTable.id, challengeId),
    });

    if (!challengeRecord || challengeRecord.expiresAt < new Date() || challengeRecord.type !== "authentication") {
      await logAudit({ req, action: "passkey.authenticate", outcome: "failure" });
      res.status(400).json({ error: "Bad Request", message: "Challenge expired or not found" });
      return;
    }

    const passkey = await db.query.passkeysTable.findFirst({
      where: eq(passkeysTable.credentialId, credential.id),
    });

    if (!passkey) {
      await logAudit({ req, action: "passkey.authenticate", outcome: "failure" });
      res.status(401).json({ error: "Unauthorized", message: "Passkey not found" });
      return;
    }

    const { rpId: rpIdVerify, origin: originVerify } = getWebAuthnConfig(req);
    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: originVerify,
      expectedRPID: rpIdVerify,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.credentialPublicKey, "base64"),
        counter: parseInt(passkey.counter),
        transports: (passkey.transports?.split(",") as AuthenticatorTransportFuture[]) || [],
      },
    });

    if (!verification.verified) {
      await logAudit({ req, action: "passkey.authenticate", outcome: "failure" });
      res.status(401).json({ error: "Unauthorized", message: "Authentication failed" });
      return;
    }

    await db
      .update(passkeysTable)
      .set({ counter: verification.authenticationInfo.newCounter.toString() })
      .where(eq(passkeysTable.id, passkey.id));

    await db.delete(webAuthnChallengesTable).where(eq(webAuthnChallengesTable.id, challengeRecord.id));

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, passkey.userId) });
    if (!user || !user.isActive) {
      await logAudit({ req, action: "passkey.authenticate", outcome: "failure", userId: passkey.userId });
      res.status(401).json({ error: "Unauthorized", message: "User not found or inactive" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    // Regenerate session ID to prevent session fixation after privilege transition
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    const session = req.session;
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    session.organisationId = user.organisationId;

    await logAudit({ req, action: "passkey.authenticate", outcome: "success", userId: user.id, userEmail: user.email });

    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisationId: user.organisationId,
      isAuthenticated: true,
    });
  } catch (err) {
    req.log.error({ err }, "Passkey auth complete failed");
    res.status(500).json({ error: "Internal Server Error", message: "Authentication failed" });
  }
});

// POST /auth/magic-link/request
router.post("/magic-link/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: "Bad Request", message: "Email is required" });
      return;
    }

    let user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (!user) {
      // Don't reveal if user exists
      res.json({ message: "If this email is registered, a magic link has been sent." });
      return;
    }

    const token = uuidv4();
    await db.insert(magicLinksTable).values({
      id: uuidv4(),
      userId: user.id,
      token,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    });

    // APP_URL can be set explicitly (e.g. to the deployed .replit.app domain).
    // Otherwise, prefer any non-dev REPLIT_DOMAINS entry, then fall back to REPLIT_DEV_DOMAIN.
    const appUrl = (() => {
      if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
      const domains = (process.env.REPLIT_DOMAINS || "").split(",").map((d) => d.trim()).filter(Boolean);
      const productionDomain = domains.find((d) => !d.includes("riker.replit.dev") && !d.includes("replit.dev"));
      const domain = productionDomain || domains[0] || process.env.REPLIT_DEV_DOMAIN?.trim() || "localhost:3001";
      return `https://${domain}`;
    })();
    const verifyUrl = `${appUrl}/auth/verify?token=${token}`;

    try {
      const { devMode } = await sendMagicLinkEmail(email, verifyUrl);
      if (devMode) {
        req.log.info({ email }, "Magic link generated (dev mode — SMTP not configured, link printed to console)");
      }
    } catch (err) {
      req.log.error({ err, email }, "Failed to send magic link email");
      await logAudit({ req, action: "magic_link.request", outcome: "failure", userEmail: email, details: { reason: "email_send_failed" } });
      res.status(503).json({ error: "Service Unavailable", message: "Email service unavailable. Please try again or contact support." });
      return;
    }

    await logAudit({ req, action: "magic_link.request", outcome: "success", userEmail: email });
    res.json({ message: "If this email is registered, a magic link has been sent." });
  } catch (err) {
    req.log.error({ err }, "Magic link request failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to send magic link" });
  }
});

// POST /auth/magic-link/verify
router.post("/magic-link/verify", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "Bad Request", message: "Token required" });
      return;
    }

    const link = await db.query.magicLinksTable.findFirst({
      where: eq(magicLinksTable.token, token),
    });

    if (!link || link.usedAt || link.expiresAt < new Date()) {
      await logAudit({ req, action: "magic_link.verify", outcome: "failure" });
      res.status(401).json({ error: "Unauthorized", message: "Invalid or expired token" });
      return;
    }

    await db.update(magicLinksTable).set({ usedAt: new Date() }).where(eq(magicLinksTable.id, link.id));

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, link.userId) });
    if (!user || !user.isActive) {
      await logAudit({ req, action: "magic_link.verify", outcome: "failure", userId: link.userId });
      res.status(401).json({ error: "Unauthorized", message: "User not found" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    // Regenerate session ID to prevent session fixation after privilege transition
    await new Promise<void>((resolve, reject) => req.session.regenerate((err) => err ? reject(err) : resolve()));
    const session = req.session;
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    session.organisationId = user.organisationId;
    // Mark email as verified in session — permits passkey enrollment without re-proving ownership
    session.verifiedEmail = user.email;

    await logAudit({ req, action: "magic_link.verify", outcome: "success", userId: user.id, userEmail: user.email });

    res.json({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organisationId: user.organisationId,
      isAuthenticated: true,
    });
  } catch (err) {
    req.log.error({ err }, "Magic link verify failed");
    res.status(500).json({ error: "Internal Server Error", message: "Verification failed" });
  }
});

// POST /auth/logout
router.post("/logout", async (req, res) => {
  await logAudit({ req, action: "auth.logout", outcome: "success" });
  req.session.destroy(() => {
    res.json({ message: "Logged out successfully" });
  });
});

export default router;
