import { Router } from "express";
import { db, usersTable, magicLinksTable, organisationsTable, auditLogsTable, passkeysTable, ssoIdentitiesTable } from "@workspace/db";
import { eq, and, count, desc, inArray } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { randomBytes, createHash } from "node:crypto";
import { requireAuth, requireOrgAccess, requireRole } from "../lib/auth.js";
import { logAudit } from "../lib/audit.js";
import { sendInviteEmail } from "../lib/mailer.js";

const VALID_SIGN_IN_METHODS = ["magic_link", "passkey", "google_sso", "microsoft_sso"] as const;
type ValidSignInMethod = (typeof VALID_SIGN_IN_METHODS)[number];
const VALID_REQUIRED_PROVIDERS = ["none", "google", "microsoft"] as const;

const router = Router({ mergeParams: true });

const INVITE_LINK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — matches invite email copy.

function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

function appBaseUrl(req: { get(name: string): string | undefined; protocol: string; headers: Record<string, unknown> }): string {
  const host = req.get("host");
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol || "https";
  return `${proto}://${host}`;
}

const VALID_ORG_ROLES = ["org_admin", "org_viewer"] as const;
type OrgRole = (typeof VALID_ORG_ROLES)[number];

function resolveAllowedRoles(callerRole: string | undefined): OrgRole[] {
  // Super admins and org admins can both invite/promote users to any in-org role.
  // Viewers and other read-only roles cannot manage users at all.
  if (callerRole === "super_admin") return ["org_admin", "org_viewer"];
  if (callerRole === "org_admin")   return ["org_admin", "org_viewer"];
  return [];
}

// GET /organisations/:orgId/users
//
// In addition to the user records themselves, each row is enriched with:
//   - signInMethodCount   — total enrolled methods (passkeys + SSO identities)
//   - staleSignInMethods  — methods unused for 90+ days (or never used and
//                           enrolled 90+ days ago — same rule as the Account
//                           page, see STALE_THRESHOLD_DAYS in account.tsx).
// This lets the admin Users table flag dormant sign-in methods at a glance
// without an extra round-trip per row.
router.get("/", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const users = await db.query.usersTable.findMany({
      where: eq(usersTable.organisationId, orgId),
    });
    const [{ total }] = await db
      .select({ total: count() })
      .from(usersTable)
      .where(eq(usersTable.organisationId, orgId));

    const userIds = users.map((u) => u.id);
    const STALE_THRESHOLD_DAYS = 90;
    // Calendar-day comparison (not raw 24h windows) so the stale set on this
    // admin view exactly matches what the user sees on the Account page —
    // see daysSince()/isStale() in artifacts/enviroiq/src/pages/account.tsx.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();
    const isStale = (ref: Date): boolean => {
      const startOfRef = new Date(ref);
      startOfRef.setHours(0, 0, 0, 0);
      const days = Math.round((startOfTodayMs - startOfRef.getTime()) / (24 * 60 * 60 * 1000));
      return days >= STALE_THRESHOLD_DAYS;
    };

    type StaleMethod = {
      kind: "passkey" | "google_sso" | "microsoft_sso";
      label: string;
      lastUsedAt: string | null;
    };
    const counts = new Map<string, number>();
    const stale = new Map<string, StaleMethod[]>();

    if (userIds.length > 0) {
      const passkeys = await db
        .select({
          userId: passkeysTable.userId,
          label: passkeysTable.label,
          deviceType: passkeysTable.deviceType,
          createdAt: passkeysTable.createdAt,
          lastUsedAt: passkeysTable.lastUsedAt,
        })
        .from(passkeysTable)
        .where(inArray(passkeysTable.userId, userIds));

      const ssoIdents = await db
        .select({
          userId: ssoIdentitiesTable.userId,
          provider: ssoIdentitiesTable.provider,
          providerEmail: ssoIdentitiesTable.providerEmail,
          linkedAt: ssoIdentitiesTable.linkedAt,
          lastUsedAt: ssoIdentitiesTable.lastUsedAt,
        })
        .from(ssoIdentitiesTable)
        .where(inArray(ssoIdentitiesTable.userId, userIds));

      for (const pk of passkeys) {
        counts.set(pk.userId, (counts.get(pk.userId) ?? 0) + 1);
        // Reference timestamp for "stale": last-used if known, else enrolment.
        // Mirrors isStale() on the Account page so admins and users see the
        // same set of stale methods.
        if (isStale(pk.lastUsedAt ?? pk.createdAt)) {
          // Friendly label fallback: user-supplied label → device-type heuristic
          // → generic "Passkey". Matches what users see on the Account page.
          const fallback =
            pk.deviceType === "multiDevice" ? "Synced passkey" : pk.deviceType ? "Device passkey" : "Passkey";
          const list = stale.get(pk.userId) ?? [];
          list.push({
            kind: "passkey",
            label: pk.label?.trim() || fallback,
            lastUsedAt: pk.lastUsedAt ? pk.lastUsedAt.toISOString() : null,
          });
          stale.set(pk.userId, list);
        }
      }

      for (const id of ssoIdents) {
        counts.set(id.userId, (counts.get(id.userId) ?? 0) + 1);
        // ssoIdentities.lastUsedAt is NOT NULL (defaults to now() at link time)
        // so a freshly-linked identity isn't flagged immediately.
        if (isStale(id.lastUsedAt)) {
          const list = stale.get(id.userId) ?? [];
          list.push({
            kind: id.provider === "google" ? "google_sso" : "microsoft_sso",
            label: id.provider === "google" ? "Google SSO" : "Microsoft SSO",
            lastUsedAt: id.lastUsedAt.toISOString(),
          });
          stale.set(id.userId, list);
        }
      }
    }

    const items = users.map((u) => ({
      ...u,
      signInMethodCount: counts.get(u.id) ?? 0,
      staleSignInMethods: stale.get(u.id) ?? [],
    }));

    res.json({ items, total });
  } catch (err) {
    req.log.error({ err }, "List users failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to list users" });
  }
});

// POST /organisations/:orgId/users
router.post("/", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const { email, name, role } = req.body;
    if (!email || !name || !role) {
      res.status(400).json({ error: "Bad Request", message: "email, name, role required" });
      return;
    }

    const callerRole = req.user?.role;
    const allowedRoles = resolveAllowedRoles(callerRole);
    if (!allowedRoles.includes(role as OrgRole)) {
      res.status(403).json({
        error: "Forbidden",
        message: `Cannot assign role '${role}'. Allowed roles for your level: ${allowedRoles.join(", ")}`,
      });
      return;
    }

    const existing = await db.query.usersTable.findFirst({ where: eq(usersTable.email, email) });
    if (existing) {
      res.status(409).json({ error: "Conflict", message: "User with this email already exists" });
      return;
    }

    const [user] = await db
      .insert(usersTable)
      .values({ id: uuidv4(), email, name, role, organisationId: orgId })
      .returning();

    await logAudit({ req, action: "user.create", resourceType: "user", resourceId: user.id, organisationId: orgId, details: { email, role } });

    // Issue an invite magic-link and email it. Failure here must NOT roll back
    // the user record (the admin can re-trigger by inviting again or the user
    // can request a sign-in link themselves), but we surface the email status
    // in the response so the UI can show "invite sent" vs "user created — email failed".
    let inviteEmailSent = false;
    let inviteEmailError: string | null = null;
    try {
      const org = await db.query.organisationsTable.findFirst({
        where: eq(organisationsTable.id, orgId),
      });
      const orgName = org?.name || "your organisation";

      const token = newToken(32);
      const expiresAt = new Date(Date.now() + INVITE_LINK_TTL_MS);
      await db.insert(magicLinksTable).values({
        id: uuidv4(),
        userId: user.id,
        token: hashToken(token),
        expiresAt,
      });

      const url = `${appBaseUrl(req)}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;
      const result = await sendInviteEmail(email, name, orgName, url);
      inviteEmailSent = result.sent;
      await logAudit({
        req,
        action: "user.invite_email",
        outcome: result.sent ? "success" : "failure",
        userId: user.id,
        organisationId: orgId,
        details: { devMode: result.devMode },
      });
    } catch (err) {
      inviteEmailError = err instanceof Error ? err.message : "unknown";
      req.log.error({ err, userId: user.id, email }, "Invite email send failed");
      await logAudit({
        req,
        action: "user.invite_email",
        outcome: "failure",
        userId: user.id,
        organisationId: orgId,
        details: { error: inviteEmailError },
      });
    }

    res.status(201).json({ ...user, inviteEmailSent, inviteEmailError });
  } catch (err) {
    req.log.error({ err }, "Create user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create user" });
  }
});

// GET /organisations/:orgId/users/:userId
router.get("/:userId", requireAuth, requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
    const user = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!user) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Get user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to get user" });
  }
});

// PATCH /organisations/:orgId/users/:userId
router.patch("/:userId", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
    const { name, role, isActive } = req.body;

    if (role !== undefined) {
      const callerRole = req.user?.role;
      const allowedRoles = resolveAllowedRoles(callerRole);
      if (!allowedRoles.includes(role as OrgRole)) {
        res.status(403).json({
          error: "Forbidden",
          message: `Cannot assign role '${role}'. Allowed roles for your level: ${allowedRoles.join(", ")}`,
        });
        return;
      }
    }

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };
    if (name !== undefined) updateFields.name = name;
    if (role !== undefined) updateFields.role = role;
    if (isActive !== undefined) updateFields.isActive = isActive;

    const [user] = await db
      .update(usersTable)
      .set(updateFields)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)))
      .returning();

    if (!user) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }
    await logAudit({ req, action: "user.update", resourceType: "user", resourceId: userId, organisationId: orgId, details: { role } });
    res.json(user);
  } catch (err) {
    req.log.error({ err }, "Update user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update user" });
  }
});

// POST /organisations/:orgId/users/sign-in-policy/bulk
// Apply the same sign-in restriction override to many users at once.
// Body: { userIds: string[], requiredSignInProvider?: ..., allowedSignInMethods?: ... }
// - Either field may be omitted, explicitly null (clear override → inherit), or a value.
// - Lock-out validation runs per user; users that would be locked out are reported in `skipped`.
// - One `user.sign_in_policy.changed` audit event is emitted per successfully-updated user
//   (with details.bulk = true and details.batchSize), matching the per-user PATCH format.
// NOTE: Path placed before /:userId/* routes — Express matches literal segments first so
// "sign-in-policy" cannot collide with the :userId param (different second segment).
router.post(
  "/sign-in-policy/bulk",
  requireAuth,
  requireRole("super_admin", "org_admin"),
  requireOrgAccess,
  async (req, res) => {
    try {
      const orgId = req.params.orgId as string;
      const body = req.body as {
        userIds?: unknown;
        requiredSignInProvider?: unknown;
        allowedSignInMethods?: unknown;
      };

      if (
        !Array.isArray(body.userIds) ||
        body.userIds.length === 0 ||
        !body.userIds.every((id) => typeof id === "string" && id.length > 0)
      ) {
        res.status(400).json({
          error: "Bad Request",
          message: "userIds must be a non-empty array of user id strings",
        });
        return;
      }
      const userIds = Array.from(new Set(body.userIds as string[]));

      // Same field validation as the per-user PATCH /:userId/sign-in-policy.
      const update: { requiredSignInProvider?: string | null; allowedSignInMethods?: ValidSignInMethod[] | null } = {};
      const hasRequiredField = Object.prototype.hasOwnProperty.call(body, "requiredSignInProvider");
      const hasAllowedField = Object.prototype.hasOwnProperty.call(body, "allowedSignInMethods");

      if (hasRequiredField) {
        const v = body.requiredSignInProvider;
        if (v !== null && (typeof v !== "string" || !(VALID_REQUIRED_PROVIDERS as readonly string[]).includes(v))) {
          res.status(400).json({
            error: "Bad Request",
            message: "requiredSignInProvider must be null, 'none', 'google', or 'microsoft'",
          });
          return;
        }
        update.requiredSignInProvider = v as string | null;
      }

      if (hasAllowedField) {
        const v = body.allowedSignInMethods;
        if (v !== null) {
          if (
            !Array.isArray(v) ||
            v.length === 0 ||
            !v.every(
              (m): m is ValidSignInMethod =>
                typeof m === "string" && (VALID_SIGN_IN_METHODS as readonly string[]).includes(m),
            )
          ) {
            res.status(400).json({
              error: "Bad Request",
              message:
                "allowedSignInMethods must be null (inherit) or a non-empty array of: " +
                VALID_SIGN_IN_METHODS.join(", "),
            });
            return;
          }
          update.allowedSignInMethods = Array.from(new Set(v)) as ValidSignInMethod[];
        } else {
          update.allowedSignInMethods = null;
        }
      }

      if (!hasRequiredField && !hasAllowedField) {
        res.status(400).json({
          error: "Bad Request",
          message: "Provide at least one of requiredSignInProvider or allowedSignInMethods to apply.",
        });
        return;
      }

      const org = await db.query.organisationsTable.findFirst({
        where: eq(organisationsTable.id, orgId),
      });
      if (!org) {
        res.status(404).json({ error: "Not Found", message: "Organisation not found" });
        return;
      }

      const updated: Array<{
        userId: string;
        email: string;
        name: string | null;
        requiredSignInProvider: string | null;
        allowedSignInMethods: ValidSignInMethod[] | null;
      }> = [];
      const skipped: Array<{
        userId: string;
        email?: string;
        name?: string | null;
        reason: "not_found" | "would_lock_out";
        message: string;
      }> = [];

      for (const userId of userIds) {
        const previous = await db.query.usersTable.findFirst({
          where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
        });
        if (!previous) {
          skipped.push({
            userId,
            reason: "not_found",
            message: "User not found in this organisation",
          });
          continue;
        }

        // Effective-usability invariant — identical to per-user PATCH so behaviour matches.
        const nextRequired =
          (hasRequiredField
            ? (update.requiredSignInProvider as string | null)
            : (previous.requiredSignInProvider as string | null)) ?? null;
        const nextAllowedRaw = hasAllowedField
          ? (update.allowedSignInMethods as ValidSignInMethod[] | null)
          : (previous.allowedSignInMethods as ValidSignInMethod[] | null);
        const effectiveRequired: "google" | "microsoft" | null =
          nextRequired === "google" || nextRequired === "microsoft"
            ? nextRequired
            : nextRequired === "none"
              ? null
              : ((org.requiredSsoProvider as "google" | "microsoft" | null) ?? null);
        const effectiveAllowed: ValidSignInMethod[] =
          nextAllowedRaw && nextAllowedRaw.length > 0
            ? nextAllowedRaw
            : ((org.allowedSignInMethods as ValidSignInMethod[] | null) ?? [...VALID_SIGN_IN_METHODS]);

        const usable = effectiveAllowed.filter((m) => {
          if (m === "magic_link" || m === "passkey") return effectiveRequired === null;
          if (m === "google_sso") return org.googleSsoEnabled && (effectiveRequired ?? "google") === "google";
          if (m === "microsoft_sso") return org.microsoftSsoEnabled && (effectiveRequired ?? "microsoft") === "microsoft";
          return false;
        });

        if (usable.length === 0 && previous.role !== "org_admin" && previous.role !== "super_admin") {
          skipped.push({
            userId,
            email: previous.email,
            name: previous.name,
            reason: "would_lock_out",
            message:
              "These restrictions would lock this user out — at least one allowed sign-in method must be effectively reachable.",
          });
          continue;
        }

        const setFields: Record<string, unknown> = { updatedAt: new Date() };
        if (hasRequiredField) setFields.requiredSignInProvider = update.requiredSignInProvider;
        if (hasAllowedField) setFields.allowedSignInMethods = update.allowedSignInMethods;

        const [u] = await db
          .update(usersTable)
          .set(setFields)
          .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)))
          .returning();

        await logAudit({
          req,
          action: "user.sign_in_policy.changed",
          resourceType: "user",
          resourceId: userId,
          // Pass organisationId explicitly so super-admin sessions (which have
          // no session.organisationId) still produce rows scoped to the target
          // tenant — otherwise the per-user history endpoint and the per-org
          // audit log filter both miss the entry.
          organisationId: orgId,
          previousValue: {
            requiredSignInProvider: previous.requiredSignInProvider,
            allowedSignInMethods: previous.allowedSignInMethods,
          },
          newValue: {
            requiredSignInProvider: u.requiredSignInProvider,
            allowedSignInMethods: u.allowedSignInMethods,
          },
          details: { bulk: true, batchSize: userIds.length },
        });

        updated.push({
          userId: u.id,
          email: u.email,
          name: u.name,
          requiredSignInProvider: u.requiredSignInProvider as string | null,
          allowedSignInMethods: u.allowedSignInMethods as ValidSignInMethod[] | null,
        });
      }

      res.json({
        updated,
        skipped,
        requested: userIds.length,
        orgPolicy: {
          googleSsoEnabled: org.googleSsoEnabled,
          microsoftSsoEnabled: org.microsoftSsoEnabled,
          allowedSignInMethods: org.allowedSignInMethods ?? [],
          requiredSsoProvider: org.requiredSsoProvider,
        },
      });
    } catch (err) {
      req.log.error({ err }, "Bulk update user sign-in policy failed");
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to bulk-update sign-in policy",
      });
    }
  },
);

// GET /organisations/:orgId/users/:userId/sign-in-policy
// Returns the per-user override (NULLs mean "inherit org") plus the org policy
// snapshot, so the admin UI can render the inherited values as placeholders.
router.get("/:userId/sign-in-policy", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
    const user = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!user) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, orgId),
    });
    res.json({
      userId: user.id,
      requiredSignInProvider: user.requiredSignInProvider, // null | "none" | "google" | "microsoft"
      allowedSignInMethods: user.allowedSignInMethods,     // null | array
      orgPolicy: {
        googleSsoEnabled: org?.googleSsoEnabled ?? true,
        microsoftSsoEnabled: org?.microsoftSsoEnabled ?? true,
        allowedSignInMethods: org?.allowedSignInMethods ?? [],
        requiredSsoProvider: org?.requiredSsoProvider ?? null,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Get user sign-in policy failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load sign-in policy" });
  }
});

// GET /organisations/:orgId/users/:userId/sign-in-policy/history
// Returns recent `user.sign_in_policy.changed` audit entries for this user, so
// the admin UI can render a timeline of who changed what and when without
// jumping to the global audit log page.
router.get(
  "/:userId/sign-in-policy/history",
  requireAuth,
  requireRole("super_admin", "org_admin"),
  requireOrgAccess,
  async (req, res) => {
    try {
      const orgId = req.params.orgId as string;
      const userId = req.params.userId as string;
      // Accept ?limit but clamp to a sane positive range so a negative or
      // garbage value can't blow up the SQL driver.
      const rawLimit = parseInt(req.query.limit as string);
      const limit = Math.min(Math.max(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 25, 1), 100);

      // Confirm the user exists in this org so we don't leak audit data for
      // users belonging to a different organisation.
      const user = await db.query.usersTable.findFirst({
        where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
      });
      if (!user) {
        res.status(404).json({ error: "Not Found", message: "User not found" });
        return;
      }

      const items = await db
        .select({
          id: auditLogsTable.id,
          createdAt: auditLogsTable.createdAt,
          actorUserId: auditLogsTable.userId,
          actorEmail: auditLogsTable.userEmail,
          actorType: auditLogsTable.actorType,
          previousValue: auditLogsTable.previousValue,
          newValue: auditLogsTable.newValue,
        })
        .from(auditLogsTable)
        .where(
          and(
            eq(auditLogsTable.organisationId, orgId),
            eq(auditLogsTable.action, "user.sign_in_policy.changed"),
            eq(auditLogsTable.resourceType, "user"),
            eq(auditLogsTable.resourceId, userId),
          ),
        )
        .orderBy(desc(auditLogsTable.createdAt))
        .limit(limit);

      res.json({ items });
    } catch (err) {
      req.log.error({ err }, "Get user sign-in policy history failed");
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to load sign-in policy history",
      });
    }
  },
);

// PATCH /organisations/:orgId/users/:userId/sign-in-policy
// Accepts { requiredSignInProvider, allowedSignInMethods }. Either field may be:
//   - omitted          → leave unchanged
//   - explicitly null  → clear override (inherit org)
//   - a value          → set override
// Audit event `user.sign_in_policy.changed` is emitted with previous/new values.
router.patch("/:userId/sign-in-policy", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;
    const body = req.body as {
      requiredSignInProvider?: unknown;
      allowedSignInMethods?: unknown;
    };

    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (Object.prototype.hasOwnProperty.call(body, "requiredSignInProvider")) {
      const v = body.requiredSignInProvider;
      if (v !== null && (typeof v !== "string" || !(VALID_REQUIRED_PROVIDERS as readonly string[]).includes(v))) {
        res.status(400).json({
          error: "Bad Request",
          message: "requiredSignInProvider must be null, 'none', 'google', or 'microsoft'",
        });
        return;
      }
      update.requiredSignInProvider = v;
    }

    if (Object.prototype.hasOwnProperty.call(body, "allowedSignInMethods")) {
      const v = body.allowedSignInMethods;
      if (v !== null) {
        if (
          !Array.isArray(v) ||
          v.length === 0 ||
          !v.every(
            (m): m is ValidSignInMethod =>
              typeof m === "string" && (VALID_SIGN_IN_METHODS as readonly string[]).includes(m),
          )
        ) {
          res.status(400).json({
            error: "Bad Request",
            message:
              "allowedSignInMethods must be null (inherit) or a non-empty array of: " +
              VALID_SIGN_IN_METHODS.join(", "),
          });
          return;
        }
        update.allowedSignInMethods = Array.from(new Set(v)) as ValidSignInMethod[];
      } else {
        update.allowedSignInMethods = null;
      }
    }

    const previous = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!previous) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }

    // Effective-usability invariant: don't let an admin save an override that
    // would lock this user out (e.g. allowedSignInMethods=["google_sso"] when
    // the org has Google disabled, or requiredSignInProvider="google" with
    // the chosen allow-list excluding google_sso). Mirrors the org-level
    // check in PATCH /organisations/:orgId/sso-policy.
    const org = await db.query.organisationsTable.findFirst({
      where: eq(organisationsTable.id, orgId),
    });
    if (!org) {
      res.status(404).json({ error: "Not Found", message: "Organisation not found" });
      return;
    }
    const nextRequired = (Object.prototype.hasOwnProperty.call(update, "requiredSignInProvider")
      ? (update.requiredSignInProvider as string | null)
      : (previous.requiredSignInProvider as string | null)) ?? null;
    const nextAllowedRaw = Object.prototype.hasOwnProperty.call(update, "allowedSignInMethods")
      ? (update.allowedSignInMethods as ValidSignInMethod[] | null)
      : (previous.allowedSignInMethods as ValidSignInMethod[] | null);
    const effectiveRequired: "google" | "microsoft" | null =
      nextRequired === "google" || nextRequired === "microsoft"
        ? nextRequired
        : nextRequired === "none"
          ? null
          : ((org.requiredSsoProvider as "google" | "microsoft" | null) ?? null);
    const effectiveAllowed: ValidSignInMethod[] =
      nextAllowedRaw && nextAllowedRaw.length > 0
        ? nextAllowedRaw
        : ((org.allowedSignInMethods as ValidSignInMethod[] | null) ?? [...VALID_SIGN_IN_METHODS]);

    const usable = effectiveAllowed.filter((m) => {
      if (m === "magic_link" || m === "passkey") return effectiveRequired === null;
      if (m === "google_sso") return org.googleSsoEnabled && (effectiveRequired ?? "google") === "google";
      if (m === "microsoft_sso") return org.microsoftSsoEnabled && (effectiveRequired ?? "microsoft") === "microsoft";
      return false;
    });
    // Allow admins to be saved into a state that ordinarily would lock out a
    // non-admin, since they retain magic-link break-glass anyway.
    if (usable.length === 0 && previous.role !== "org_admin" && previous.role !== "super_admin") {
      res.status(400).json({
        error: "Bad Request",
        message:
          "These restrictions would lock this user out — at least one allowed sign-in method must be effectively reachable. Adjust allowedSignInMethods or requiredSignInProvider so they are mutually consistent with the organisation policy.",
      });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set(update)
      .where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)))
      .returning();

    await logAudit({
      req,
      action: "user.sign_in_policy.changed",
      resourceType: "user",
      resourceId: userId,
      // Pass organisationId explicitly so super-admin sessions (which have no
      // session.organisationId) still produce rows scoped to the target
      // tenant — otherwise the per-user history endpoint and the per-org
      // audit log filter both miss the entry.
      organisationId: orgId,
      previousValue: {
        requiredSignInProvider: previous.requiredSignInProvider,
        allowedSignInMethods: previous.allowedSignInMethods,
      },
      newValue: {
        requiredSignInProvider: updated.requiredSignInProvider,
        allowedSignInMethods: updated.allowedSignInMethods,
      },
    });

    res.json({
      userId: updated.id,
      requiredSignInProvider: updated.requiredSignInProvider,
      allowedSignInMethods: updated.allowedSignInMethods,
      orgPolicy: {
        googleSsoEnabled: org.googleSsoEnabled,
        microsoftSsoEnabled: org.microsoftSsoEnabled,
        allowedSignInMethods: org.allowedSignInMethods ?? [],
        requiredSsoProvider: org.requiredSsoProvider,
      },
    });
  } catch (err) {
    req.log.error({ err }, "Update user sign-in policy failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update sign-in policy" });
  }
});

// DELETE /organisations/:orgId/users/:userId
router.delete("/:userId", requireAuth, requireRole("super_admin", "org_admin"), requireOrgAccess, async (req, res) => {
  try {
    const orgId = req.params.orgId as string;
    const userId = req.params.userId as string;

    const existing = await db.query.usersTable.findFirst({
      where: and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)),
    });
    if (!existing) {
      res.status(404).json({ error: "Not Found", message: "User not found" });
      return;
    }

    if (existing.role === "super_admin") {
      res.status(403).json({ error: "Forbidden", message: "Cannot delete a super_admin user" });
      return;
    }

    await db.delete(usersTable).where(and(eq(usersTable.id, userId), eq(usersTable.organisationId, orgId)));
    await logAudit({ req, action: "user.delete", resourceType: "user", resourceId: userId, organisationId: orgId });
    res.json({ message: "User removed" });
  } catch (err) {
    req.log.error({ err }, "Delete user failed");
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete user" });
  }
});

export default router;
