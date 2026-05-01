import { Router } from "express";
import type { Request, Response } from "express";
import {
  db,
  usersTable,
  magicLinksTable,
  passkeysTable,
  webAuthnChallengesTable,
  organisationsTable,
  ssoIdentitiesTable,
} from "@workspace/db";
import { eq, and, gt, isNull } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, createHash } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/server";
import { logAudit } from "../lib/audit.js";
import { requireAuth, checkSignInMethodAllowed, type SignInMethod } from "../lib/auth.js";
import { sendMagicLinkEmail } from "../lib/mailer.js";
import {
  buildAuthorizeUrl,
  buildRedirectUri,
  configuredProviders,
  exchangeCodeForTokens,
  isProviderConfigured,
  verifyIdToken,
  type OidcProviderName,
} from "../lib/oidc.js";

const router = Router();

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 minutes
const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RP_NAME = "EnviroIQ";

/** Resolve rpID + origin from the request — supports custom domain + .replit.app + dev preview. */
function getWebAuthnContext(req: Request): { rpID: string; expectedOrigin: string } {
  const host = req.get("host") || req.hostname;
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  const hostname = host.split(":")[0];
  return { rpID: hostname, expectedOrigin: `${proto}://${host}` };
}

function appBaseUrl(req: Request): string {
  const host = req.get("host");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${host}`;
}

function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** SHA-256 the token before storing/looking up so DB compromise doesn't leak usable links. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Atomically rotate the session ID before binding a user — defends against session fixation. */
function regenerateSession(req: import("express").Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

async function pruneExpiredChallenges(): Promise<void> {
  try {
    await db.delete(webAuthnChallengesTable).where(
      // Drizzle: lt would be cleaner; using gt-not for portability
      // We delete rows where expiresAt < now()
      // Using sql template would be safer but eq/gt on timestamp suffices
      // — we just delete with raw expression below.
      // Simpler: leave pruning to a background job; here we no-op safely.
      eq(webAuthnChallengesTable.id, ""),
    );
  } catch {
    /* ignore */
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Session
// ─────────────────────────────────────────────────────────────────────────────

router.get("/session", requireAuth, async (req, res) => {
  const user = req.user!;
  void db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));

  let organisationName: string | null = null;
  if (user.organisationId) {
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, user.organisationId),
    });
    organisationName = org?.name ?? null;
  }

  res.json({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organisationId: user.organisationId,
    organisationName,
    isAuthenticated: true,
  });
});

router.post("/logout", async (req, res) => {
  const userId = req.session?.userId;
  await new Promise<void>((resolve) => {
    req.session?.destroy(() => resolve());
  });
  res.clearCookie("eiq.sid", { path: "/" });
  res.clearCookie("connect.sid", { path: "/" });
  await logAudit({ req, action: "auth.logout", outcome: "success", userId: userId });
  res.json({ message: "Logged out successfully" });
});

// ─────────────────────────────────────────────────────────────────────────────
// Magic link
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /auth/magic-link/request
 * Body: { email: string }
 *
 * Always returns 200 with the same generic message — never reveals whether the
 * email is registered (account-enumeration defence).
 */
router.post("/magic-link/request", async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const generic = { ok: true, message: "If that email is registered, a sign-in link has been sent." };

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: "Invalid email" });
    return;
  }

  try {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (!user || !user.isActive) {
      // Constant-time-ish: still log so we have signal, then return generic.
      await logAudit({ req, action: "auth.magic_link.request.unknown", outcome: "failure", details: { email } });
      res.json(generic);
      return;
    }

    // Org policy: refuse if magic-link is not allowed for this org and the
    // user is not eligible for the org_admin break-glass exception.
    const policy = await checkSignInMethodAllowed(user.organisationId, user.role, "magic_link", { requiredSignInProvider: user.requiredSignInProvider, allowedSignInMethods: user.allowedSignInMethods });
    if (!policy.ok) {
      await logAudit({
        req,
        action: "auth.magic_link.request",
        outcome: "failure",
        organisationId: user.organisationId ?? undefined,
        userId: user.id,
        userEmail: user.email,
        details: { reason: policy.reason, email },
      });
      // Don't leak whether the email exists; just return the generic response.
      res.json(generic);
      return;
    }
    if (policy.breakGlass) {
      await logAudit({
        req,
        action: "auth.break_glass_magic_link",
        outcome: "success",
        organisationId: user.organisationId ?? undefined,
        userId: user.id,
        userEmail: user.email,
        details: { email, role: user.role },
      });
    }

    const token = newToken(32);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
    await db.insert(magicLinksTable).values({
      id: uuidv4(),
      userId: user.id,
      token: hashToken(token), // store hash, not the raw token
      expiresAt,
    });

    const url = `${appBaseUrl(req)}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
    await sendMagicLinkEmail(email, url);
    await logAudit({ req, action: "auth.magic_link.request", outcome: "success", userId: user.id });
    res.json(generic);
  } catch (err) {
    req.log?.error({ err, email }, "magic-link request failed");
    res.json(generic); // never leak failure mode to the client
  }
});

/**
 * GET /auth/magic-link/verify?token=xxx
 *
 * Consumes the token, creates a session, and redirects the browser into the app.
 * Top-level navigation from an email link, so this MUST be a GET that 302s
 * rather than a POST that returns JSON.
 */
router.get("/magic-link/verify", async (req, res) => {
  const token = String(req.query.token || "");
  const base = appBaseUrl(req);

  if (!token) {
    res.redirect(`${base}/app/sign-in?error=invalid_link`);
    return;
  }

  try {
    const link = await db.query.magicLinksTable.findFirst({
      where: and(
        eq(magicLinksTable.token, hashToken(token)),
        isNull(magicLinksTable.usedAt),
        gt(magicLinksTable.expiresAt, new Date()),
      ),
    });

    if (!link) {
      await logAudit({ req, action: "auth.magic_link.verify", outcome: "failure", details: { reason: "invalid_or_expired" } });
      res.redirect(`${base}/app/sign-in?error=expired`);
      return;
    }

    // Atomically mark used (prevent token replay).
    const [marked] = await db
      .update(magicLinksTable)
      .set({ usedAt: new Date() })
      .where(and(eq(magicLinksTable.id, link.id), isNull(magicLinksTable.usedAt)))
      .returning();
    if (!marked) {
      res.redirect(`${base}/app/sign-in?error=already_used`);
      return;
    }

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, link.userId) });
    if (!user || !user.isActive) {
      res.redirect(`${base}/app/sign-in?error=account_inactive`);
      return;
    }

    // Rotate session ID before binding the user (anti-fixation), then establish the session.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    req.session.organisationId = user.organisationId;
    req.session.verifiedEmail = user.email;

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await logAudit({ req, action: "auth.magic_link.verify", outcome: "success", userId: user.id });

    // Check if user has any passkeys — if not, send them to the enrolment screen.
    const existingPasskey = await db.query.passkeysTable.findFirst({ where: eq(passkeysTable.userId, user.id) });
    const dest = existingPasskey ? "/app/dashboard" : "/app/account?enroll_passkey=1";

    req.session.save(() => res.redirect(`${base}${dest}`));
  } catch (err) {
    req.log?.error({ err }, "magic-link verify failed");
    res.redirect(`${base}/app/sign-in?error=server_error`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Passkey — Registration (must be signed in or have verifiedEmail in session)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/passkey/register/options", requireAuth, async (req, res) => {
  const user = req.user!;
  const { rpID } = getWebAuthnContext(req);

  const existing = await db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, user.id) });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existing.map((p) => ({
      id: p.credentialId,
      transports: p.transports ? (p.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
      authenticatorAttachment: "platform",
    },
  });

  const challengeId = uuidv4();
  await db.insert(webAuthnChallengesTable).values({
    id: challengeId,
    challenge: options.challenge,
    email: user.email,
    type: "registration",
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  req.session.webAuthnChallengeId = challengeId;
  await new Promise<void>((r) => req.session.save(() => r()));

  res.json(options);
});

router.post("/passkey/register/verify", requireAuth, async (req, res) => {
  const user = req.user!;
  const { rpID, expectedOrigin } = getWebAuthnContext(req);

  // Single generic error for both missing- and expired-challenge cases —
  // returning distinct messages would let callers tell whether a session
  // had a challenge bound to it (probe signal). See login/verify below.
  const REGISTER_CHALLENGE_INVALID = "Registration challenge invalid or expired";
  const challengeId = req.session.webAuthnChallengeId;
  if (!challengeId) {
    res.status(400).json({ error: REGISTER_CHALLENGE_INVALID });
    return;
  }

  const challengeRow = await db.query.webAuthnChallengesTable.findFirst({
    where: and(eq(webAuthnChallengesTable.id, challengeId), gt(webAuthnChallengesTable.expiresAt, new Date())),
  });
  if (!challengeRow || challengeRow.type !== "registration") {
    res.status(400).json({ error: REGISTER_CHALLENGE_INVALID });
    return;
  }

  try {
    const verification = await verifyRegistrationResponse({
      response: req.body as RegistrationResponseJSON,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verification.verified || !verification.registrationInfo) {
      await logAudit({ req, action: "auth.passkey.register", outcome: "failure", userId: user.id });
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await db.insert(passkeysTable).values({
      id: uuidv4(),
      userId: user.id,
      credentialId: credential.id,
      credentialPublicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: String(credential.counter),
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
      transports: credential.transports?.join(",") || null,
    });

    delete req.session.webAuthnChallengeId;
    await db.delete(webAuthnChallengesTable).where(eq(webAuthnChallengesTable.id, challengeId));
    await logAudit({ req, action: "auth.passkey.register", outcome: "success", userId: user.id });

    res.json({ verified: true });
  } catch (err) {
    req.log?.error({ err }, "passkey register verify failed");
    res.status(400).json({ error: "Verification failed" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Passkey — Login (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

router.post("/passkey/login/options", async (req, res) => {
  const { rpID } = getWebAuthnContext(req);
  const email = String(req.body?.email || "").trim().toLowerCase();

  let allowCredentials: Array<{ id: string; transports?: AuthenticatorTransportFuture[] }> = [];
  if (email) {
    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (user) {
      // Org policy: refuse if passkey login isn't allowed for this org. We
      // surface a 403 so the UI can show "passkeys disabled — use SSO".
      const policy = await checkSignInMethodAllowed(user.organisationId, user.role, "passkey", { requiredSignInProvider: user.requiredSignInProvider, allowedSignInMethods: user.allowedSignInMethods });
      if (!policy.ok) {
        await logAudit({
          req,
          action: "auth.passkey.login",
          outcome: "failure",
          userId: user.id,
          details: { reason: policy.reason, stage: "options" },
        });
        res.status(403).json({ error: "Passkey sign-in is not enabled for your organisation. Please use the SSO option." });
        return;
      }
      const passkeys = await db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, user.id) });
      allowCredentials = passkeys.map((p) => ({
        id: p.credentialId,
        transports: p.transports ? (p.transports.split(",") as AuthenticatorTransportFuture[]) : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials,
  });

  const challengeId = uuidv4();
  await db.insert(webAuthnChallengesTable).values({
    id: challengeId,
    challenge: options.challenge,
    email: email || null,
    type: "authentication",
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
  });
  req.session.webAuthnChallengeId = challengeId;
  await new Promise<void>((r) => req.session.save(() => r()));

  res.json(options);
});

router.post("/passkey/login/verify", async (req, res) => {
  const { rpID, expectedOrigin } = getWebAuthnContext(req);

  // Single generic error for both missing- and expired-challenge cases —
  // emitting distinct messages would let an attacker probe whether a given
  // session has a challenge bound (e.g. has previously called /options).
  const LOGIN_CHALLENGE_INVALID = "Authentication challenge invalid or expired";
  const challengeId = req.session.webAuthnChallengeId;
  if (!challengeId) {
    res.status(400).json({ error: LOGIN_CHALLENGE_INVALID });
    return;
  }

  const challengeRow = await db.query.webAuthnChallengesTable.findFirst({
    where: and(eq(webAuthnChallengesTable.id, challengeId), gt(webAuthnChallengesTable.expiresAt, new Date())),
  });
  if (!challengeRow || challengeRow.type !== "authentication") {
    res.status(400).json({ error: LOGIN_CHALLENGE_INVALID });
    return;
  }

  try {
    const response = req.body as AuthenticationResponseJSON;
    const passkey = await db.query.passkeysTable.findFirst({
      where: eq(passkeysTable.credentialId, response.id),
    });
    if (!passkey) {
      await logAudit({ req, action: "auth.passkey.login", outcome: "failure", details: { reason: "credential_unknown" } });
      res.status(400).json({ error: "Unknown credential" });
      return;
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin,
      expectedRPID: rpID,
      credential: {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.credentialPublicKey, "base64url"),
        counter: Number(passkey.counter) || 0,
        transports: passkey.transports
          ? (passkey.transports.split(",") as AuthenticatorTransportFuture[])
          : undefined,
      },
      requireUserVerification: false,
    });

    if (!verification.verified) {
      await logAudit({ req, action: "auth.passkey.login", outcome: "failure", userId: passkey.userId });
      res.status(400).json({ error: "Verification failed" });
      return;
    }

    // Update counter
    await db
      .update(passkeysTable)
      .set({ counter: String(verification.authenticationInfo.newCounter) })
      .where(eq(passkeysTable.id, passkey.id));

    const user = await db.query.usersTable.findFirst({ where: eq(usersTable.id, passkey.userId) });
    if (!user || !user.isActive) {
      res.status(403).json({ error: "Account inactive" });
      return;
    }

    // Org policy enforcement at the verify step too — defends against an
    // attacker who calls /verify directly without going through /options.
    const policy = await checkSignInMethodAllowed(user.organisationId, user.role, "passkey", { requiredSignInProvider: user.requiredSignInProvider, allowedSignInMethods: user.allowedSignInMethods });
    if (!policy.ok) {
      await logAudit({
        req,
        action: "auth.passkey.login",
        outcome: "failure",
        userId: user.id,
        details: { reason: policy.reason, stage: "verify" },
      });
      res.status(403).json({ error: policy.message ?? "Passkey sign-in is not enabled for your organisation." });
      return;
    }

    // Rotate session ID before binding the user (anti-fixation).
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    req.session.organisationId = user.organisationId;
    req.session.verifiedEmail = user.email;

    await db.delete(webAuthnChallengesTable).where(eq(webAuthnChallengesTable.id, challengeId));
    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await logAudit({ req, action: "auth.passkey.login", outcome: "success", userId: user.id });

    req.session.save(() =>
      res.json({
        verified: true,
        user: {
          userId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          organisationId: user.organisationId,
        },
      }),
    );
  } catch (err) {
    req.log?.error({ err }, "passkey login verify failed");
    res.status(400).json({ error: "Verification failed" });
  }
});

/**
 * Resolve the target user for a "view another user" admin lookup.
 * - If `targetUserId` is missing or matches the caller, returns the caller's id (self).
 * - Otherwise the caller must be a super_admin OR an org_admin in the same org as the target.
 *
 * Returns either { ok: true, userId, isSelf } or { ok: false, status, message } so callers
 * can short-circuit with the right HTTP response.
 */
async function resolveTargetUserId(
  req: Request,
  targetUserId: string | undefined,
): Promise<
  | { ok: true; userId: string; isSelf: boolean }
  | { ok: false; status: number; message: string }
> {
  const caller = req.user!;
  if (!targetUserId || targetUserId === caller.id) {
    return { ok: true, userId: caller.id, isSelf: true };
  }
  if (caller.role === "super_admin") {
    return { ok: true, userId: targetUserId, isSelf: false };
  }
  if (caller.role !== "org_admin") {
    return { ok: false, status: 403, message: "Admin access required to view another user." };
  }
  const target = await db.query.usersTable.findFirst({ where: eq(usersTable.id, targetUserId) });
  if (!target) return { ok: false, status: 404, message: "User not found" };
  if (target.organisationId !== caller.organisationId) {
    return { ok: false, status: 403, message: "Cannot view a user outside your organisation." };
  }
  return { ok: true, userId: target.id, isSelf: false };
}

/**
 * GET /auth/passkeys — list passkeys (id + metadata only).
 * Defaults to the current user. An `org_admin`/`super_admin` may pass `?userId=`
 * to view another in-org user's passkeys (read-only — deletion is owner-only).
 */
router.get("/passkeys", requireAuth, async (req, res) => {
  const target = await resolveTargetUserId(req, typeof req.query.userId === "string" ? req.query.userId : undefined);
  if (!target.ok) {
    res.status(target.status).json({ error: target.message });
    return;
  }
  const passkeys = await db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, target.userId) });
  res.json(
    passkeys.map((p) => ({
      id: p.id,
      deviceType: p.deviceType,
      backedUp: p.backedUp,
      createdAt: p.createdAt,
    })),
  );
});

/** DELETE /auth/passkeys/:id — remove a passkey (owner only). */
router.delete("/passkeys/:id", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  const passkey = await db.query.passkeysTable.findFirst({ where: eq(passkeysTable.id, id) });
  if (!passkey || passkey.userId !== req.user!.id) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  await db.delete(passkeysTable).where(eq(passkeysTable.id, id));
  await logAudit({ req, action: "auth.passkey.delete", outcome: "success", userId: req.user!.id, details: { passkeyId: id } });
  res.json({ ok: true });
});

/**
 * GET /auth/sso/identities — list linked SSO identities (provider, providerEmail,
 * linkedAt, lastUsedAt). Defaults to the current user; an `org_admin`/`super_admin`
 * may pass `?userId=` to view another in-org user's identities.
 */
router.get("/sso/identities", requireAuth, async (req, res) => {
  const target = await resolveTargetUserId(
    req,
    typeof req.query.userId === "string" ? req.query.userId : undefined,
  );
  if (!target.ok) {
    res.status(target.status).json({ error: target.message });
    return;
  }
  const identities = await db.query.ssoIdentitiesTable.findMany({
    where: eq(ssoIdentitiesTable.userId, target.userId),
  });
  res.json(
    identities.map((i) => ({
      id: i.id,
      provider: i.provider,
      providerEmail: i.providerEmail,
      linkedAt: i.linkedAt,
      lastUsedAt: i.lastUsedAt,
    })),
  );
});

/**
 * DELETE /auth/sso/identities/:id — unlink a linked Google/Microsoft identity.
 * Owner-only. Refuses to remove the user's *only* strong sign-in path
 * (i.e. when removing this identity would leave them with no passkeys and no
 * other SSO identities). Magic-link recovery via verified email remains
 * available even after unlinking, but we never strand a user with zero strong
 * factors.
 */
router.delete("/sso/identities/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const id = req.params.id as string;

  const identity = await db.query.ssoIdentitiesTable.findFirst({
    where: eq(ssoIdentitiesTable.id, id),
  });
  if (!identity || identity.userId !== userId) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  // Compute remaining sign-in factors AFTER this delete.
  const [remainingIdentities, remainingPasskeys] = await Promise.all([
    db.query.ssoIdentitiesTable.findMany({ where: eq(ssoIdentitiesTable.userId, userId) }),
    db.query.passkeysTable.findMany({ where: eq(passkeysTable.userId, userId) }),
  ]);
  const otherIdentitiesCount = remainingIdentities.filter((r) => r.id !== id).length;
  const passkeyCount = remainingPasskeys.length;

  if (otherIdentitiesCount === 0 && passkeyCount === 0) {
    await logAudit({
      req,
      action: "sso.identity.unlinked",
      outcome: "failure",
      userId,
      details: {
        identityId: id,
        provider: identity.provider,
        reason: "would_leave_no_sign_in_path",
      },
    });
    res.status(409).json({
      error: "last_sign_in_path",
      message:
        "This is your only sign-in method. Add a passkey or link another SSO provider before unlinking it.",
    });
    return;
  }

  await db.delete(ssoIdentitiesTable).where(eq(ssoIdentitiesTable.id, id));
  await logAudit({
    req,
    action: "sso.identity.unlinked",
    outcome: "success",
    userId,
    userEmail: identity.providerEmail,
    details: {
      identityId: id,
      provider: identity.provider,
      providerEmail: identity.providerEmail,
    },
  });
  res.json({ ok: true });
});

void pruneExpiredChallenges; // silence unused-var lint

// ─────────────────────────────────────────────────────────────────────────────
// SSO (Native Google + Microsoft OIDC, Authorization Code + PKCE)
// ─────────────────────────────────────────────────────────────────────────────

const SSO_FLOW_TTL_MS = 10 * 60 * 1000; // 10 minutes

function ssoErrorRedirect(
  req: Request,
  res: Response,
  code: string,
  source?: "user" | "org",
): void {
  // Land the user back on the sign-in page with a recognisable code; the UI
  // surfaces a friendly message. Never include any provider-side detail.
  // `source` is included only for policy-driven refusals so the UI can phrase
  // the message as "your account" (per-user override) vs "your organisation"
  // (org-level policy). This is safe because the user has already proven
  // ownership of the email at the IdP — we are not enumerating accounts.
  const base = appBaseUrl(req);
  const qs = new URLSearchParams({ error: `sso_${code}` });
  if (source) qs.set("source", source);
  res.redirect(`${base}/app/sign-in?${qs.toString()}`);
}

function safeReturnTo(raw: unknown): string | undefined {
  const r = typeof raw === "string" ? raw : "";
  if (!r) return undefined;
  // Only allow same-origin app paths under /app — never an arbitrary URL.
  if (!r.startsWith("/app/") && r !== "/app") return undefined;
  return r;
}

/** PKCE: SHA-256(code_verifier), base64url. */
function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function isOidcProviderName(value: string): value is OidcProviderName {
  return value === "google" || value === "microsoft";
}

/**
 * GET /auth/sso/:provider/start
 * Begins an SSO sign-in: stores PKCE verifier + state + nonce in the session,
 * then 302-redirects the browser to the provider's authorize endpoint.
 */
router.get("/sso/:provider/start", async (req, res) => {
  const provider = String(req.params.provider || "");
  if (!isOidcProviderName(provider)) {
    res.status(404).json({ error: "Unknown SSO provider" });
    return;
  }
  if (!isProviderConfigured(provider)) {
    req.log?.warn({ provider }, "SSO start refused — provider not configured");
    ssoErrorRedirect(req, res, "not_configured");
    return;
  }

  try {
    const state = newToken(24);
    const nonce = newToken(24);
    const codeVerifier = newToken(48);
    const codeChallenge = pkceChallenge(codeVerifier);
    const redirectUri = buildRedirectUri(provider, appBaseUrl(req));

    req.session.oidcFlow = {
      provider,
      state,
      nonce,
      codeVerifier,
      redirectUri,
      returnTo: safeReturnTo(req.query.returnTo),
      createdAt: Date.now(),
    };
    await new Promise<void>((r) => req.session.save(() => r()));

    const authorizeUrl = await buildAuthorizeUrl(provider, {
      state,
      nonce,
      codeChallenge,
      redirectUri,
    });
    res.redirect(authorizeUrl);
  } catch (err) {
    req.log?.error({ err, provider }, "SSO start failed");
    ssoErrorRedirect(req, res, "start_failed");
  }
});

/**
 * GET /auth/sso/:provider/callback
 * Handles the provider's redirect: validates state, exchanges code, verifies
 * id_token, looks up the user, applies org policy, starts the session.
 */
router.get("/sso/:provider/callback", async (req, res) => {
  const provider = String(req.params.provider || "");
  if (!isOidcProviderName(provider)) {
    res.status(404).json({ error: "Unknown SSO provider" });
    return;
  }

  // Provider-side error (user denied consent, etc).
  if (typeof req.query.error === "string") {
    await logAudit({
      req,
      action: "sso.sign_in.rejected",
      outcome: "failure",
      details: { provider, reason: "provider_error", providerError: String(req.query.error) },
    });
    ssoErrorRedirect(req, res, "denied");
    return;
  }

  const code = String(req.query.code || "");
  const state = String(req.query.state || "");
  const flow = req.session.oidcFlow;

  // State validation MUST happen before anything else.
  if (!flow || flow.provider !== provider || !state || flow.state !== state) {
    await logAudit({
      req,
      action: "sso.sign_in.rejected",
      outcome: "failure",
      details: { provider, reason: "state_mismatch" },
    });
    delete req.session.oidcFlow;
    ssoErrorRedirect(req, res, "state");
    return;
  }
  if (Date.now() - flow.createdAt > SSO_FLOW_TTL_MS) {
    delete req.session.oidcFlow;
    await logAudit({
      req,
      action: "sso.sign_in.rejected",
      outcome: "failure",
      details: { provider, reason: "flow_expired" },
    });
    ssoErrorRedirect(req, res, "expired");
    return;
  }
  if (!code) {
    delete req.session.oidcFlow;
    await logAudit({
      req,
      action: "sso.sign_in.rejected",
      outcome: "failure",
      details: { provider, reason: "missing_code" },
    });
    ssoErrorRedirect(req, res, "missing_code");
    return;
  }

  try {
    let tokens;
    try {
      tokens = await exchangeCodeForTokens(provider, {
        code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri,
      });
    } catch (err) {
      await logAudit({
        req,
        action: "sso.sign_in.rejected",
        outcome: "failure",
        details: { provider, reason: "token_exchange_failed", error: (err as Error).message },
      });
      delete req.session.oidcFlow;
      ssoErrorRedirect(req, res, "token");
      return;
    }

    let verified;
    try {
      verified = await verifyIdToken(provider, tokens.id_token, flow.nonce);
    } catch (err) {
      const reason = (err as Error).message;
      await logAudit({
        req,
        action: "sso.sign_in.rejected",
        outcome: "failure",
        details: { provider, reason: `id_token_${reason}` },
      });
      delete req.session.oidcFlow;
      ssoErrorRedirect(req, res, "token");
      return;
    }

    if (!verified.emailVerified) {
      await logAudit({
        req,
        action: "sso.sign_in.rejected",
        outcome: "failure",
        userEmail: verified.email,
        details: { provider, reason: "email_not_verified" },
      });
      delete req.session.oidcFlow;
      ssoErrorRedirect(req, res, "email_unverified");
      return;
    }

    // 1) Try (provider, sub) first — survives email changes at the IdP.
    let identity = await db.query.ssoIdentitiesTable.findFirst({
      where: and(
        eq(ssoIdentitiesTable.provider, provider),
        eq(ssoIdentitiesTable.providerSub, verified.sub),
      ),
    });

    let user = identity
      ? await db.query.usersTable.findFirst({ where: eq(usersTable.id, identity.userId) })
      : await db.query.usersTable.findFirst({ where: eq(usersTable.email, verified.email) });

    if (!user || !user.isActive) {
      await logAudit({
        req,
        action: "sso.sign_in.rejected",
        outcome: "failure",
        organisationId: user?.organisationId ?? undefined,
        userId: user?.id,
        userEmail: verified.email,
        details: { provider, reason: user ? "account_inactive" : "unknown_email" },
      });
      delete req.session.oidcFlow;
      ssoErrorRedirect(req, res, user ? "account_inactive" : "unknown_email");
      return;
    }

    // 2) Org policy
    const method: SignInMethod = provider === "google" ? "google_sso" : "microsoft_sso";
    const policy = await checkSignInMethodAllowed(user.organisationId, user.role, method, { requiredSignInProvider: user.requiredSignInProvider, allowedSignInMethods: user.allowedSignInMethods });
    if (!policy.ok) {
      await logAudit({
        req,
        action: "sso.sign_in.rejected",
        outcome: "failure",
        organisationId: user.organisationId ?? undefined,
        userId: user.id,
        userEmail: verified.email,
        details: { provider, reason: policy.reason, source: policy.source },
      });
      delete req.session.oidcFlow;
      // Pass policy.source through so the sign-in page can phrase the
      // message correctly ("your account" vs "your organisation"). Safe to
      // surface here because the user has already verified email at the IdP.
      ssoErrorRedirect(req, res, policy.reason || "policy", policy.source);
      return;
    }

    // 3) Link identity on first sign-in for this (provider, sub).
    if (!identity) {
      const [inserted] = await db
        .insert(ssoIdentitiesTable)
        .values({
          id: uuidv4(),
          userId: user.id,
          provider,
          providerSub: verified.sub,
          providerEmail: verified.email,
        })
        .returning();
      identity = inserted;
      await logAudit({
        req,
        action: "sso.identity.linked",
        outcome: "success",
        organisationId: user.organisationId ?? undefined,
        userId: user.id,
        userEmail: verified.email,
        details: { provider },
      });
    } else {
      await db
        .update(ssoIdentitiesTable)
        .set({ lastUsedAt: new Date(), providerEmail: verified.email })
        .where(eq(ssoIdentitiesTable.id, identity.id));
    }

    // 4) Establish session — same shape as the magic-link flow.
    await regenerateSession(req);
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.name = user.name;
    req.session.role = user.role as "super_admin" | "org_admin" | "org_viewer";
    req.session.organisationId = user.organisationId ?? undefined;
    req.session.verifiedEmail = user.email;
    delete req.session.oidcFlow;

    await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
    await logAudit({
      req,
      action: "sso.sign_in.success",
      outcome: "success",
      organisationId: user.organisationId ?? undefined,
      userId: user.id,
      userEmail: verified.email,
      details: { provider },
    });

    const dest = flow.returnTo || "/app/dashboard";
    const base = appBaseUrl(req);
    // returnTo is already validated to start with /app
    const target = dest.startsWith("/app") ? dest.replace(/^\/app/, "") || "/dashboard" : "/dashboard";
    req.session.save(() => res.redirect(`${base}/app${target.startsWith("/") ? target : `/${target}`}`));
  } catch (err) {
    req.log?.error({ err, provider }, "SSO callback failed");
    try {
      await logAudit({
        req,
        action: "sso.sign_in.rejected",
        outcome: "failure",
        details: { provider, reason: "server_error", error: (err as Error).message },
      });
    } catch {
      // best-effort audit; don't mask the redirect
    }
    delete req.session.oidcFlow;
    ssoErrorRedirect(req, res, "server_error");
  }
});

/**
 * GET /auth/sso/providers — surfaces which SSO buttons the UI should render.
 * Public endpoint (no PII), used by the sign-in page to hide buttons when the
 * platform OAuth client isn't yet configured for that provider.
 */
router.get("/sso/providers", (_req, res) => {
  res.json({ providers: configuredProviders() });
});

export default router;
