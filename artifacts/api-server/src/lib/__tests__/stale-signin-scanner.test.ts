/**
 * Tests for the monthly stale-sign-in digest scanner.
 *
 * Guards the contract from Task #33:
 *   - Users with at least one passkey OR SSO identity unused for 90+ days
 *     receive a digest. Brand-new (created <90d ago, never used) methods are NOT flagged.
 *   - Each user gets at most ONE digest per calendar month — the second
 *     run in the same month is a no-op.
 *   - Inactive users are skipped.
 *   - The digest is logged in the audit log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface StaleItem { label: string; lastUsedLabel: string; ageDays: number }
const sendMock = vi.fn(
  async (
    _to: string,
    _name: string,
    _items: StaleItem[],
    _accountUrl: string,
  ) => ({ sent: true, devMode: false, messageId: "msg-1" }),
);
vi.mock("../mailer.js", () => ({
  sendStaleSignInMethodsEmail: sendMock,
}));

const auditMock = vi.fn(async (_input: { action: string; [k: string]: unknown }) => "audit-id");
vi.mock("../audit.js", () => ({ logAudit: auditMock }));

interface PasskeyRow { id: string; userId: string; label: string | null; deviceType: string | null; lastUsedAt: Date | null; createdAt: Date }
interface SsoRow { id: string; userId: string; provider: string; providerEmail: string; lastUsedAt: Date; linkedAt: Date }
interface UserRow { id: string; email: string; name: string | null; organisationId: string | null; isActive: boolean }
interface EventRow { id: string; dedupeKey: string }

const dbState: {
  passkeys: PasskeyRow[];
  sso: SsoRow[];
  users: UserRow[];
  events: EventRow[];
} = { passkeys: [], sso: [], users: [], events: [] };

// Set by the eq() mock when select() is about to read EVENTS, so the SELECT
// mock can return only the marker rows that match the queried dedupe key.
let pendingDedupeKeyFilter: string | null = null;

const PASSKEYS = Symbol("passkeys");
const SSO = Symbol("sso");
const USERS = Symbol("users");
const EVENTS = Symbol("events");

// Mirrors the threshold inside the scanner so the mock can apply the same
// "stale" filter the real Postgres `where` clause would.
const MOCK_CUTOFF = new Date(new Date("2026-05-07T09:00:00Z").getTime() - 90 * 86400_000);

vi.mock("@workspace/db", () => {
  const select = (cols: Record<string, { _table: symbol }>) => {
    const tableSym = Object.values(cols)[0]?._table;
    return {
      from: () => ({
        where: () => {
          if (tableSym === PASSKEYS) {
            return Promise.resolve(
              dbState.passkeys.filter((p) =>
                (p.lastUsedAt !== null && p.lastUsedAt < MOCK_CUTOFF) ||
                (p.lastUsedAt === null && p.createdAt < MOCK_CUTOFF),
              ),
            );
          }
          if (tableSym === SSO) {
            return Promise.resolve(dbState.sso.filter((s) => s.lastUsedAt < MOCK_CUTOFF));
          }
          if (tableSym === USERS) return Promise.resolve(dbState.users.map((u) => ({ ...u })));
          if (tableSym === EVENTS) {
            // Existence check used by alreadySentThisMonth: the eq() mock
            // captured the dedupeKey filter argument so we can return only
            // markers matching the requested key.
            const key = pendingDedupeKeyFilter;
            pendingDedupeKeyFilter = null;
            const rows = key === null
              ? dbState.events
              : dbState.events.filter((e) => e.dedupeKey === key);
            return Promise.resolve(rows.map((e) => ({ id: e.id })));
          }
          return Promise.resolve([]);
        },
      }),
    };
  };
  const col = (table: symbol) => ({ _table: table });
  return {
    db: {
      select,
      insert: () => ({
        values: (row: { dedupeKey: string; id: string }) => ({
          onConflictDoNothing: () => ({
            returning: () => {
              if (dbState.events.some((e) => e.dedupeKey === row.dedupeKey)) {
                return Promise.resolve([]);
              }
              dbState.events.push({ id: row.id, dedupeKey: row.dedupeKey });
              return Promise.resolve([{ id: row.id }]);
            },
          }),
        }),
      }),
    },
    notificationEventsTable: {
      id: { _table: EVENTS },
      dedupeKey: { _table: EVENTS, _isDedupeKey: true },
    },
    passkeysTable: {
      id: col(PASSKEYS), userId: col(PASSKEYS), label: col(PASSKEYS),
      deviceType: col(PASSKEYS), lastUsedAt: col(PASSKEYS), createdAt: col(PASSKEYS),
    },
    ssoIdentitiesTable: {
      id: col(SSO), userId: col(SSO), provider: col(SSO),
      providerEmail: col(SSO), lastUsedAt: col(SSO), linkedAt: col(SSO),
    },
    usersTable: {
      id: col(USERS), email: col(USERS), name: col(USERS),
      organisationId: col(USERS), isActive: col(USERS),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ _and: a }),
  or: (...a: unknown[]) => ({ _or: a }),
  eq: (col: { _isDedupeKey?: boolean }, val: unknown) => {
    if (col?._isDedupeKey && typeof val === "string") {
      pendingDedupeKeyFilter = val;
    }
    return { _eq: [col, val] };
  },
  inArray: (...a: unknown[]) => ({ _in: a }),
  lt: (...a: unknown[]) => ({ _lt: a }),
  isNull: (...a: unknown[]) => ({ _null: a }),
}));

const NOW = new Date("2026-05-07T09:00:00Z");
const DAY = 86400_000;
const STALE_AGO = new Date(NOW.getTime() - 100 * DAY);
const FRESH = new Date(NOW.getTime() - 10 * DAY);

beforeEach(() => {
  dbState.passkeys = [];
  dbState.sso = [];
  dbState.users = [];
  dbState.events = [];
  sendMock.mockClear();
  auditMock.mockClear();
});

describe("stale-signin-scanner", () => {
  it("emails users with at least one passkey/SSO unused for 90+ days, skips fresh and never-used-but-young methods", async () => {
    dbState.users = [
      { id: "u1", email: "alice@example.com", name: "Alice", organisationId: "org1", isActive: true },
      { id: "u2", email: "bob@example.com", name: "Bob", organisationId: "org1", isActive: true },
    ];
    dbState.passkeys = [
      // u1 has one stale passkey (last used 100d ago)
      { id: "pk1", userId: "u1", label: "MacBook", deviceType: "singleDevice", lastUsedAt: STALE_AGO, createdAt: STALE_AGO },
      // u1 has one fresh passkey — should NOT appear
      { id: "pk2", userId: "u1", label: null, deviceType: "multiDevice", lastUsedAt: FRESH, createdAt: FRESH },
      // u2's passkey was never used but is also fresh — must NOT be flagged
      { id: "pk3", userId: "u2", label: null, deviceType: "multiDevice", lastUsedAt: null, createdAt: FRESH },
    ];
    dbState.sso = [
      // u2 has a stale Google SSO link
      { id: "s1", userId: "u2", provider: "google", providerEmail: "bob@gmail.com", lastUsedAt: STALE_AGO, linkedAt: STALE_AGO },
    ];

    const { runStaleSignInDigestOnce, __resetStaleSignInDigestState } = await import("../stale-signin-scanner.js");
    __resetStaleSignInDigestState();
    const summary = await runStaleSignInDigestOnce({ now: NOW });

    expect(summary.usersScanned).toBe(2);
    expect(summary.digestsSent).toBe(2);
    expect(summary.itemsReported).toBe(2);

    expect(sendMock).toHaveBeenCalledTimes(2);
    const aliceCall = sendMock.mock.calls.find((c) => c[0] === "alice@example.com");
    expect(aliceCall?.[2]).toHaveLength(1);
    expect((aliceCall?.[2] as Array<{ label: string }>)[0].label).toContain("MacBook");
    const bobCall = sendMock.mock.calls.find((c) => c[0] === "bob@example.com");
    expect((bobCall?.[2] as Array<{ label: string }>)[0].label).toContain("Google");

    expect(auditMock).toHaveBeenCalledTimes(2);
    expect(auditMock.mock.calls[0][0].action).toBe("stale_signin.digest_sent");
  });

  it("sends at most one digest per user per calendar month", async () => {
    dbState.users = [
      { id: "u1", email: "alice@example.com", name: "Alice", organisationId: "org1", isActive: true },
    ];
    dbState.passkeys = [
      { id: "pk1", userId: "u1", label: null, deviceType: "singleDevice", lastUsedAt: STALE_AGO, createdAt: STALE_AGO },
    ];

    const { runStaleSignInDigestOnce, __resetStaleSignInDigestState } = await import("../stale-signin-scanner.js");
    __resetStaleSignInDigestState();
    const first = await runStaleSignInDigestOnce({ now: NOW });
    const second = await runStaleSignInDigestOnce({ now: new Date(NOW.getTime() + 2 * DAY) });

    expect(first.digestsSent).toBe(1);
    expect(second.digestsSent).toBe(0);
    expect(second.digestsSuppressed).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("does not stamp the monthly marker when the email send fails — next tick retries", async () => {
    dbState.users = [
      { id: "u1", email: "alice@example.com", name: "Alice", organisationId: "org1", isActive: true },
    ];
    dbState.passkeys = [
      { id: "pk1", userId: "u1", label: null, deviceType: "singleDevice", lastUsedAt: STALE_AGO, createdAt: STALE_AGO },
    ];

    const { runStaleSignInDigestOnce, __resetStaleSignInDigestState } = await import("../stale-signin-scanner.js");
    __resetStaleSignInDigestState();

    // First run: mailer reports failure (e.g. transient Resend outage).
    sendMock.mockResolvedValueOnce({ sent: false, devMode: false, messageId: undefined });
    const first = await runStaleSignInDigestOnce({ now: NOW });
    expect(first.digestsSent).toBe(0);
    expect(first.digestsFailed).toBe(1);
    expect(dbState.events).toHaveLength(0); // no marker stamped on failure
    expect(auditMock).toHaveBeenCalledTimes(1);
    expect(auditMock.mock.calls[0][0].outcome).toBe("failure");

    // Second run (e.g. next daily tick): mailer succeeds — user gets retried.
    const second = await runStaleSignInDigestOnce({ now: new Date(NOW.getTime() + DAY) });
    expect(second.digestsSent).toBe(1);
    expect(second.digestsSuppressed).toBe(0);
    expect(dbState.events).toHaveLength(1);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });

  it("skips inactive users entirely", async () => {
    dbState.users = [
      { id: "u1", email: "off@example.com", name: "Ex", organisationId: "org1", isActive: false },
    ];
    dbState.passkeys = [
      { id: "pk1", userId: "u1", label: null, deviceType: "singleDevice", lastUsedAt: STALE_AGO, createdAt: STALE_AGO },
    ];

    const { runStaleSignInDigestOnce, __resetStaleSignInDigestState } = await import("../stale-signin-scanner.js");
    __resetStaleSignInDigestState();
    const summary = await runStaleSignInDigestOnce({ now: NOW });
    expect(summary.usersScanned).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
  });
});
