// Monthly digest: emails users about passkeys / SSO identities they
// haven't used in 90+ days, with a one-click link to the Account page.
// Re-uses the notification_events.dedupe_key UNIQUE index as a per-user,
// per-calendar-month idempotency lock so each user receives at most one
// digest per month even across restarts or multiple processes.

import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, or, isNull } from "drizzle-orm";
import {
  db,
  notificationEventsTable,
  passkeysTable,
  ssoIdentitiesTable,
  usersTable,
} from "@workspace/db";
import { logger } from "./logger.js";
import {
  sendStaleSignInMethodsEmail,
  type StaleSignInMethodItem,
} from "./mailer.js";
import { logAudit } from "./audit.js";

/** Mirrors the 90-day threshold shown on the Account page. */
export const STALE_SIGNIN_THRESHOLD_DAYS = 90;

function appBase(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const dom = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (dom) return `https://${dom}/app`;
  return "http://localhost:5173";
}

function ymdMonth(when: Date): string {
  return `${when.getUTCFullYear()}-${String(when.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysSince(when: Date, now: Date): number {
  return Math.floor((now.getTime() - when.getTime()) / 86400_000);
}

function lastUsedLabel(lastUsedAt: Date | null): string {
  if (!lastUsedAt) return "Never used";
  const d = lastUsedAt;
  const month = d.toLocaleString("en-NZ", { month: "short", timeZone: "UTC" });
  return `Last used ${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

interface UserDigest {
  userId: string;
  email: string;
  name: string | null;
  organisationId: string | null;
  items: StaleSignInMethodItem[];
}

/**
 * Find users with at least one passkey or SSO identity whose effective
 * last-used timestamp is older than the threshold. "Effective last-used"
 * mirrors the Account-page rule: NULL → fall back to creation time, so
 * brand-new methods aren't flagged on day 1.
 */
export async function findStaleSignInMethods(now: Date): Promise<UserDigest[]> {
  const cutoff = new Date(now.getTime() - STALE_SIGNIN_THRESHOLD_DAYS * 86400_000);

  // Stale passkeys: lastUsedAt < cutoff OR (lastUsedAt IS NULL AND createdAt < cutoff).
  const stalePasskeys = await db
    .select({
      id: passkeysTable.id,
      userId: passkeysTable.userId,
      label: passkeysTable.label,
      deviceType: passkeysTable.deviceType,
      lastUsedAt: passkeysTable.lastUsedAt,
      createdAt: passkeysTable.createdAt,
    })
    .from(passkeysTable)
    .where(
      or(
        lt(passkeysTable.lastUsedAt, cutoff),
        and(isNull(passkeysTable.lastUsedAt), lt(passkeysTable.createdAt, cutoff)),
      ),
    );

  const staleSso = await db
    .select({
      id: ssoIdentitiesTable.id,
      userId: ssoIdentitiesTable.userId,
      provider: ssoIdentitiesTable.provider,
      providerEmail: ssoIdentitiesTable.providerEmail,
      lastUsedAt: ssoIdentitiesTable.lastUsedAt,
      linkedAt: ssoIdentitiesTable.linkedAt,
    })
    .from(ssoIdentitiesTable)
    .where(lt(ssoIdentitiesTable.lastUsedAt, cutoff));

  if (stalePasskeys.length === 0 && staleSso.length === 0) return [];

  const userIds = Array.from(
    new Set([...stalePasskeys.map((p) => p.userId), ...staleSso.map((s) => s.userId)]),
  );
  const users = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      name: usersTable.name,
      organisationId: usersTable.organisationId,
      isActive: usersTable.isActive,
    })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));

  const byUser = new Map<string, UserDigest>();
  for (const u of users) {
    if (!u.isActive) continue;
    byUser.set(u.id, {
      userId: u.id,
      email: u.email,
      name: u.name,
      organisationId: u.organisationId,
      items: [],
    });
  }

  for (const pk of stalePasskeys) {
    const bucket = byUser.get(pk.userId);
    if (!bucket) continue;
    const reference = pk.lastUsedAt ?? pk.createdAt;
    const fallbackName = pk.deviceType === "multiDevice" ? "Synced passkey" : "Device passkey";
    const label = `Passkey: ${pk.label ?? fallbackName}`;
    bucket.items.push({
      label,
      lastUsedLabel: lastUsedLabel(pk.lastUsedAt),
      ageDays: daysSince(reference, now),
    });
  }

  for (const sso of staleSso) {
    const bucket = byUser.get(sso.userId);
    if (!bucket) continue;
    const providerLabel = sso.provider === "google"
      ? "Google"
      : sso.provider === "microsoft"
        ? "Microsoft"
        : sso.provider;
    bucket.items.push({
      label: `${providerLabel} account ${sso.providerEmail}`,
      lastUsedLabel: lastUsedLabel(sso.lastUsedAt),
      ageDays: daysSince(sso.lastUsedAt ?? sso.linkedAt, now),
    });
  }

  // Stable order: oldest item first, so the most-stale rows lead the email.
  for (const bucket of byUser.values()) {
    bucket.items.sort((a, b) => b.ageDays - a.ageDays);
  }

  return Array.from(byUser.values()).filter((u) => u.items.length > 0);
}

function dedupeKeyFor(userId: string, monthKey: string): string {
  return `stale_signin_digest:user:${userId}:${monthKey}`;
}

/**
 * Has this user already been emailed this calendar month? Cheap existence
 * check we run BEFORE attempting the (expensive) send, so we don't spam
 * Resend on every daily tick once a user has been digested for the month.
 */
async function alreadySentThisMonth(userId: string, monthKey: string): Promise<boolean> {
  const found = await db
    .select({ id: notificationEventsTable.id })
    .from(notificationEventsTable)
    .where(eq(notificationEventsTable.dedupeKey, dedupeKeyFor(userId, monthKey)));
  return found.length > 0;
}

/**
 * Stamp the per-user, per-month "sent" marker AFTER a successful send.
 * Uses notification_events.dedupe_key UNIQUE as the idempotency token —
 * if a parallel process also sent (race window between the existence
 * check and this insert), the loser's row is silently dropped via
 * onConflictDoNothing. Returns true iff THIS call wrote the marker.
 */
async function stampMonthlyDigestSent(userId: string, monthKey: string): Promise<boolean> {
  const inserted = await db
    .insert(notificationEventsTable)
    .values({
      id: randomUUID(),
      organisationId: "PLATFORM",
      category: "stale_signin_digest",
      severity: "info",
      title: "Stale sign-in methods digest",
      body: `userId=${userId} month=${monthKey}`,
      dedupeKey: dedupeKeyFor(userId, monthKey),
    })
    .onConflictDoNothing({ target: notificationEventsTable.dedupeKey })
    .returning({ id: notificationEventsTable.id });
  return inserted.length > 0;
}

export interface StaleSignInDigestSummary {
  usersScanned: number;
  /** Digests that were actually emailed (or dev-mode console-logged) this run. */
  digestsSent: number;
  /** Eligible users skipped because they were already digested this month. */
  digestsSuppressed: number;
  /** Sends that were attempted but Resend / mailer reported failure. */
  digestsFailed: number;
  /** dryRun-only: digests that would have been sent if not in dryRun. */
  digestsWouldSend: number;
  itemsReported: number;
}

/**
 * Run the scan once. Each eligible user is sent at most one digest per
 * calendar month (UTC). The monthly suppression marker is only stamped
 * AFTER a successful send, so a transient mailer outage doesn't lock a
 * user out of their digest for the rest of the month — the next daily
 * tick will retry. Always logs an audit row (`stale_signin.digest_sent`,
 * outcome=success|failure) so admins can see who was emailed and who
 * couldn't be reached.
 */
export async function runStaleSignInDigestOnce(opts: {
  dryRun?: boolean;
  now?: Date;
} = {}): Promise<StaleSignInDigestSummary> {
  const now = opts.now ?? new Date();
  const monthKey = ymdMonth(now);
  const digests = await findStaleSignInMethods(now);
  const accountUrl = `${appBase()}/account`;

  const summary: StaleSignInDigestSummary = {
    usersScanned: digests.length,
    digestsSent: 0,
    digestsSuppressed: 0,
    digestsFailed: 0,
    digestsWouldSend: 0,
    itemsReported: 0,
  };

  for (const digest of digests) {
    try {
      if (opts.dryRun) {
        summary.digestsWouldSend++;
        summary.itemsReported += digest.items.length;
        continue;
      }
      // Cheap pre-check: skip users we've already emailed this month so we
      // don't hit Resend on every daily tick once the digest has shipped.
      if (await alreadySentThisMonth(digest.userId, monthKey)) {
        summary.digestsSuppressed++;
        continue;
      }
      const result = await sendStaleSignInMethodsEmail(
        digest.email,
        digest.name ?? digest.email,
        digest.items,
        accountUrl,
      );
      const success = result.sent || result.devMode;
      if (success) {
        // Only stamp the monthly marker AFTER a confirmed send. Failed
        // sends leave the slot open so the next daily tick retries.
        await stampMonthlyDigestSent(digest.userId, monthKey);
        summary.digestsSent++;
        summary.itemsReported += digest.items.length;
      } else {
        summary.digestsFailed++;
      }
      await logAudit({
        action: "stale_signin.digest_sent",
        actorType: "scheduler",
        resourceType: "user",
        resourceId: digest.userId,
        organisationId: digest.organisationId ?? undefined,
        userId: digest.userId,
        userEmail: digest.email,
        outcome: success ? "success" : "failure",
        details: {
          monthKey,
          itemCount: digest.items.length,
          items: digest.items.map((i) => ({ label: i.label, ageDays: i.ageDays })),
          devMode: result.devMode,
          messageId: result.messageId,
        },
      });
    } catch (err) {
      logger.error({ err, userId: digest.userId }, "Stale sign-in digest failed for user — continuing");
    }
  }

  logger.info({ summary, monthKey }, "Stale sign-in digest run complete");
  return summary;
}

let staleSignInHandle: ReturnType<typeof setInterval> | null = null;
let lastRunYmd: string | null = null;

/**
 * Boot the daily scanner. Ticks every `intervalMs` (default 1h) and runs
 * the digest pass once per UTC day at the configured hour (default 09:00 UTC).
 * The per-month dedupe key inside `runStaleSignInDigestOnce` enforces the
 * "at most one email per user per month" guarantee even if the daily tick
 * runs every day.
 */
export function startStaleSignInDigestScheduler(opts?: { intervalMs?: number }): void {
  if (staleSignInHandle) return;
  const intervalMs = opts?.intervalMs && opts.intervalMs > 0 ? opts.intervalMs : 60 * 60 * 1000;
  const rawHour = Number(process.env.STALE_SIGNIN_DIGEST_HOUR_UTC);
  const targetHour = Number.isFinite(rawHour) && rawHour >= 0 && rawHour <= 23
    ? Math.floor(rawHour)
    : 9;
  const tick = async () => {
    try {
      const now = new Date();
      if (now.getUTCHours() !== targetHour) return;
      const ymd = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
      if (lastRunYmd === ymd) return;
      lastRunYmd = ymd;
      await runStaleSignInDigestOnce({ now });
    } catch (err) {
      logger.error({ err }, "Stale sign-in digest tick failed");
    }
  };
  void tick();
  staleSignInHandle = setInterval(() => { void tick(); }, intervalMs);
  logger.info({ intervalMs, targetHourUtc: targetHour }, "Stale sign-in digest scheduler started");
}

export function stopStaleSignInDigestScheduler(): void {
  if (staleSignInHandle) {
    clearInterval(staleSignInHandle);
    staleSignInHandle = null;
  }
  lastRunYmd = null;
}

/** Test-only: reset the per-day guard. */
export function __resetStaleSignInDigestState(): void {
  lastRunYmd = null;
}
