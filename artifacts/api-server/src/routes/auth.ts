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
import { logAudit } from "../lib/audit.js";

const router = Router();

const RP_NAME = "EnviroIQ";
const RP_ID = process.env.RP_ID || "localhost";
const ORIGIN = process.env.ORIGIN || `http://localhost`;

// GET /auth/session
router.get("/session", (req, res) => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Unauthorized", message: "Not authenticated" });
    return;
  }
  res.json({
    userId: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    organisationId: session.organisationId,
    organisationName: session.organisationName,
    isAuthenticated: true,
  });
});

// POST /auth/passkey/register/begin
router.post("/passkey/register/begin", async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email) {
      res.status(400).json({ error: "Bad Request", message: "Email is required" });
      return;
    }

    let user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
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

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userName: user.email,
      userDisplayName: user.name,
      userID: Buffer.from(user.id),
      attestationType: "none",
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: (pk.transports?.split(",") as any) || [],
      })),
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });

    await db.insert(webAuthnChallengesTable).values({
      id: uuidv4(),
      challenge: options.challenge,
      email,
      type: "registration",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

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

    const challengeRecord = await db.query.webAuthnChallengesTable.findFirst({
      where: eq(webAuthnChallengesTable.email, email),
    });

    if (!challengeRecord || challengeRecord.expiresAt < new Date()) {
      res.status(400).json({ error: "Bad Request", message: "Challenge expired or not found" });
      return;
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      await logAudit({ req, action: "passkey.register", outcome: "failure", userEmail: email });
      res.status(400).json({ error: "Verification Failed", message: "Passkey verification failed" });
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (!user) {
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

    const session = (req as any).session;
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role;
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

    let allowCredentials: { id: string; transports?: any[] }[] = [];
    if (email) {
      const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
      if (user) {
        const passkeys = await db.query.passkeysTable.findMany({
          where: eq(passkeysTable.userId, user.id),
        });
        allowCredentials = passkeys.map((pk) => ({
          id: pk.credentialId,
          transports: (pk.transports?.split(",") as any) || [],
        }));
      }
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials,
      userVerification: "preferred",
    });

    await db.insert(webAuthnChallengesTable).values({
      id: uuidv4(),
      challenge: options.challenge,
      email: email || null,
      type: "authentication",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

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

    const challengeRecord = await db.query.webAuthnChallengesTable.findFirst({
      where: eq(webAuthnChallengesTable.type, "authentication"),
    });

    if (!challengeRecord || challengeRecord.expiresAt < new Date()) {
      res.status(400).json({ error: "Bad Request", message: "Challenge expired" });
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

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.credentialPublicKey, "base64"),
        counter: parseInt(passkey.counter),
        transports: (passkey.transports?.split(",") as any) || [],
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
      res.status(401).json({ error: "Unauthorized", message: "User not found or inactive" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    const session = (req as any).session;
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role;
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

    // In production: send email with token. For now, log it
    req.log.info({ token, email }, "Magic link generated");

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
      res.status(401).json({ error: "Unauthorized", message: "User not found" });
      return;
    }

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

    const session = (req as any).session;
    session.userId = user.id;
    session.email = user.email;
    session.name = user.name;
    session.role = user.role;
    session.organisationId = user.organisationId;

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
  (req as any).session.destroy();
  res.json({ message: "Logged out successfully" });
});

export default router;
