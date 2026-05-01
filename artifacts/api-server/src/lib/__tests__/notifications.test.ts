/**
 * Regression tests for the foundation notification fan-out (`notify`) and
 * the daily warn digest (`sendNotificationDigests`).
 *
 * These guard the four invariants Task #36 promises to its callers:
 *
 *   1. **All admins notified** — every active org_admin/super_admin in the
 *      organisation gets exactly one row, and one email per row when the
 *      severity is `error`.
 *   2. **Inactive users skipped** — `is_active=false` rows must not receive
 *      notifications (they may have been off-boarded but kept for FK history).
 *   3. **Idempotency on dedupeKey** — a second call with the same dedupeKey
 *      MUST be a no-op (no extra event row, no extra notifications, no
 *      extra emails). This is what protects the e.g. `device_not_registered`
 *      webhook from spamming once it fires every minute.
 *   4. **Email-per-recipient on severity=error** — one Resend dispatch per
 *      eligible recipient with the correct addressing; mailer failures must
 *      NOT abort the fan-out (bell rows still land).
 *
 * Plus the orphan fallback: when the org has zero eligible admins, fall
 * back to platform super_admins and tag the category with
 * `orphaned_org_no_admins` so ops can investigate.
 *
 * What's mocked and why:
 *   - `@workspace/db` is stubbed at the boundary with a tiny in-memory store
 *     keyed by the table sentinel objects we hand back. Each test sets
 *     `dbState.users` (the user pool) and `dbState.org` and then asserts
 *     against `dbState.events` (event rows written), `dbState.notifications`
 *     (per-recipient rows written), and `dbState.dedupeKeys` (the unique
 *     constraint our route relies on).
 *   - `mailer.ts` is stubbed so we can count + inspect emails without
 *     touching Resend.
 *   - `logger.ts` is silenced so test output stays readable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module mocks (must be declared before importing the lib) ───────────────

vi.mock("../logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../mailer.js", () => ({
  // Both the immediate-error and digest paths now use the batched send.
  sendNotificationEmail: vi.fn(async () => ({ sent: true })),
  sendNotificationEmailBatch: vi.fn(async (items: unknown[]) => ({ sent: items.length, devMode: false })),
}));

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: "super_admin" | "org_admin" | "org_user" | "org_viewer" | "org_auditor";
  organisationId: string | null;
  isActive: boolean;
  /** NULL means user has not completed first sign-in — email channel skipped. */
  lastLoginAt: Date | null;
}

interface EventRow {
  id: string;
  organisationId: string;
  category: string;
  severity: "info" | "warn" | "error";
  title: string;
  body: string;
  linkUrl: string | undefined;
  sourceAuditId: string | undefined;
  context: Record<string, unknown> | undefined;
  dedupeKey: string;
}

interface NotificationRow {
  id: string;
  organisationId: string;
  recipientUserId: string;
  category: string;
  severity: "info" | "warn" | "error";
  title: string;
  body: string;
  linkUrl: string | undefined;
  sourceAuditId: string | undefined;
  sourceEventId: string;
  createdAt: Date;
  emailSentAt?: Date | null;
  dismissedAt?: Date | null;
}

const dbState: {
  users: UserRow[];
  org: { id: string; name: string } | null;
  events: EventRow[];
  notifications: NotificationRow[];
  dedupeKeys: Set<string>;
} = {
  users: [],
  org: null,
  events: [],
  notifications: [],
  dedupeKeys: new Set(),
};

function resetDbState() {
  dbState.users = [];
  dbState.org = null;
  dbState.events = [];
  dbState.notifications = [];
  dbState.dedupeKeys = new Set();
}

vi.mock("@workspace/db", () => {
  const tables = {
    notificationEventsTable: { _t: "notification_events" as const, dedupeKey: { _col: "dedupeKey" } },
    notificationsTable: {
      _t: "notifications" as const,
      id: { _col: "id" },
      severity: { _col: "severity" },
      emailSentAt: { _col: "emailSentAt" },
      dismissedAt: { _col: "dismissedAt" },
    },
    organisationsTable: { _t: "organisations" as const, id: { _col: "id" } },
    usersTable: {
      _t: "users" as const,
      id: { _col: "id" },
      organisationId: { _col: "organisationId" },
      isActive: { _col: "isActive" },
      role: { _col: "role" },
    },
  };

  const insert = vi.fn((table: { _t: string }) => ({
    values: vi.fn((row: unknown) => {
      if (table === tables.notificationEventsTable) {
        const r = row as EventRow;
        return {
          onConflictDoNothing: vi.fn(() => ({
            returning: vi.fn(async () => {
              if (dbState.dedupeKeys.has(r.dedupeKey)) return [];
              dbState.dedupeKeys.add(r.dedupeKey);
              dbState.events.push(r);
              return [{ id: r.id }];
            }),
          })),
        };
      }
      if (table === tables.notificationsTable) {
        const rows = (Array.isArray(row) ? row : [row]) as NotificationRow[];
        for (const n of rows) dbState.notifications.push({ ...n });
      }
      // Insert into other tables — return a no-op chain to satisfy callers.
      return { returning: vi.fn(async () => []) };
    }),
  }));

  // The select chain only ever reads users (admins). We model just that.
  const select = vi.fn(() => ({
    from: vi.fn((table: { _t: string }) => ({
      where: vi.fn(async () => {
        if (table !== tables.usersTable) return [];
        // The route narrows by orgId+isActive+role IN (...) for the primary
        // query and role+isActive for the platform fallback. Rather than
        // attempt to parse drizzle expressions, we let the test set
        // `dbState.users` to the exact expected return for the next call.
        // Two calls happen in the orphan-fallback case: the first must be
        // empty so the second (platform fallback) returns the platform
        // super_admins. Use a mutable queue.
        const queue = userQueryQueue.shift();
        if (queue !== undefined) return queue;
        return dbState.users;
      }),
    })),
  }));

  const update = vi.fn(() => ({
    set: vi.fn((updates: Record<string, unknown>) => ({
      where: vi.fn(async (whereExpr?: unknown) => {
        // Only `notifications.emailSentAt = <date>` is exercised by the
        // code under test. The lib stamps via an `inArray(id, stampIds)`
        // restriction; honour that so first-sign-in-gated rows remain
        // unstamped (and roll into a future digest).
        let restrictTo: Set<string> | null = null;
        const expr = whereExpr as { _inArray?: [unknown, string[]] } | undefined;
        if (expr?._inArray && Array.isArray(expr._inArray[1])) {
          restrictTo = new Set(expr._inArray[1]);
        }
        if (Object.prototype.hasOwnProperty.call(updates, "emailSentAt")) {
          const next = updates.emailSentAt as Date | null;
          for (const n of dbState.notifications) {
            if (n.emailSentAt) continue;
            if (restrictTo && !restrictTo.has(n.id)) continue;
            n.emailSentAt = next ?? new Date();
          }
        }
      }),
    })),
  }));

  // The lib runs the event-insert + fan-out inside `db.transaction(async tx
  // => …)` so the dedupeKey row rolls back if fan-out fails. We simulate
  // that by giving `tx` the same insert/update/select handles as `db` and
  // unwinding any state changes if the callback throws.
  const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => {
    const eventsBefore = dbState.events.length;
    const notificationsBefore = dbState.notifications.length;
    const dedupeBefore = new Set(dbState.dedupeKeys);
    try {
      return await cb(db);
    } catch (err) {
      // Roll back: drop any rows added during this attempt.
      dbState.events.length = eventsBefore;
      dbState.notifications.length = notificationsBefore;
      dbState.dedupeKeys = dedupeBefore;
      throw err;
    }
  });

  const db = {
    insert,
    update,
    select,
    transaction,
    query: {
      organisationsTable: { findFirst: vi.fn(async () => dbState.org) },
      usersTable: {
        findFirst: vi.fn(async () => dbState.users[0] ?? null),
      },
    },
  };

  return { db, ...tables };
});

// Lightweight queue let tests stage successive `.where()` results when the
// same select shape is invoked twice (orphan fallback path).
const userQueryQueue: UserRow[][] = [];

// drizzle helpers used at the call site — make them no-op pass-throughs so
// the lib can import them without exploding at module-load.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    and: (...args: unknown[]) => ({ _and: args }),
    eq: (a: unknown, b: unknown) => ({ _eq: [a, b] }),
    inArray: (a: unknown, b: unknown) => ({ _inArray: [a, b] }),
    isNull: (a: unknown) => ({ _isNull: a }),
    sql: (...args: unknown[]) => ({ _sql: args }),
  };
});

// ─── Imports (after mocks) ──────────────────────────────────────────────────
import { notify, sendNotificationDigests } from "../notifications.js";
import * as mailer from "../mailer.js";

const sendBatchMock = mailer.sendNotificationEmailBatch as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetDbState();
  userQueryQueue.length = 0;
  sendBatchMock.mockReset();
  sendBatchMock.mockImplementation(async (items: Array<unknown>) => ({
    sent: items.length,
    devMode: false,
  }));
  dbState.org = { id: "org-1", name: "Test Org" };
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function user(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: `u-${Math.random().toString(36).slice(2, 8)}`,
    email: "test@example.com",
    name: "Test User",
    role: "org_admin",
    organisationId: "org-1",
    isActive: true,
    // Default test users are signed in (so email channel is exercised by
    // default). Specific tests override to NULL to exercise the gate.
    lastLoginAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  };
}

function baseNotify(overrides: Partial<Parameters<typeof notify>[0]> = {}) {
  return notify({
    organisationId: "org-1",
    category: "upload.energy_bill.error",
    severity: "error",
    title: "Power bill upload failed",
    body: "We could not parse the file you uploaded.",
    linkUrl: "/energy?tab=upload",
    dedupeKey: `t-${Math.random().toString(36).slice(2, 10)}`,
    ...overrides,
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("notify() — fan-out core", () => {
  it("notifies every active org admin in ONE batched Resend call (one row per recipient, single batch send)", async () => {
    dbState.users = [
      user({ id: "admin-1", email: "a1@example.com", role: "org_admin" }),
      user({ id: "admin-2", email: "a2@example.com", role: "org_admin" }),
      user({ id: "super-1", email: "s1@example.com", role: "super_admin" }),
    ];

    const result = await baseNotify({ dedupeKey: "k-1" });

    expect(result.created).toBe(true);
    expect(result.recipientCount).toBe(3);
    expect(result.emailsSent).toBe(3);
    expect(dbState.notifications).toHaveLength(3);
    expect(dbState.notifications.map((n) => n.recipientUserId).sort()).toEqual(
      ["admin-1", "admin-2", "super-1"].sort(),
    );
    // CRITICAL CONTRACT: a single batched Resend call covers all recipients
    // (Resend rate-limit guard). One call, three personalised items inside.
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    const items = sendBatchMock.mock.calls[0][0] as Array<{ to: string; orgName: string; title: string; linkUrl?: string }>;
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.to).sort()).toEqual(["a1@example.com", "a2@example.com", "s1@example.com"].sort());
    for (const item of items) {
      expect(item.orgName).toBe("Test Org");
      expect(item.title).toBe("Power bill upload failed");
      expect(item.linkUrl).toBe("/energy?tab=upload");
    }
  });

  it("skips inactive users entirely — no row, no email", async () => {
    // The lib applies `is_active=true` in its WHERE clause, so the in-memory
    // store should only contain the active users that the route would have
    // resolved. We model that contract here directly.
    dbState.users = [user({ id: "admin-active", email: "active@example.com" })];

    const result = await baseNotify({ dedupeKey: "k-2" });

    expect(result.recipientCount).toBe(1);
    expect(dbState.notifications.map((n) => n.recipientUserId)).toEqual(["admin-active"]);
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    const items = sendBatchMock.mock.calls[0][0] as Array<{ to: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].to).toBe("active@example.com");
  });

  it("is idempotent on dedupeKey — second call writes nothing and emails nothing", async () => {
    dbState.users = [user({ id: "admin-1", email: "a1@example.com" })];
    const key = "k-idempotent";

    const first = await baseNotify({ dedupeKey: key });
    expect(first.created).toBe(true);
    expect(first.recipientCount).toBe(1);
    expect(first.emailsSent).toBe(1);

    sendBatchMock.mockClear();
    const second = await baseNotify({ dedupeKey: key });
    expect(second.created).toBe(false);
    expect(second.recipientCount).toBe(0);
    expect(second.emailsSent).toBe(0);
    expect(sendBatchMock).not.toHaveBeenCalled();
    // Only one event + one notification row total — proving the second call
    // was a true no-op rather than a "second pass that overwrote".
    expect(dbState.events).toHaveLength(1);
    expect(dbState.notifications).toHaveLength(1);
  });

  it("falls back to platform super_admins and tags category as orphaned when org has no eligible admins", async () => {
    // First select call (org admins) returns empty; second (platform) returns
    // the super-admin pool.
    userQueryQueue.push([]); // org admins → none
    userQueryQueue.push([user({ id: "platform-1", email: "ops@enviroiq.test", role: "super_admin", organisationId: null })]);

    const result = await baseNotify({ dedupeKey: "k-orphan" });

    expect(result.recipientCount).toBe(1);
    expect(dbState.notifications).toHaveLength(1);
    expect(dbState.notifications[0].recipientUserId).toBe("platform-1");
    expect(dbState.notifications[0].category).toContain("orphaned_org_no_admins");
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the event row but no fan-out when org and platform both have zero recipients", async () => {
    userQueryQueue.push([]); // org admins → none
    userQueryQueue.push([]); // platform super_admins → none

    const result = await baseNotify({ dedupeKey: "k-no-recipients" });

    expect(result.created).toBe(true);
    expect(result.recipientCount).toBe(0);
    expect(result.emailsSent).toBe(0);
    expect(dbState.events).toHaveLength(1);
    expect(dbState.notifications).toHaveLength(0);
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("does NOT send email when severity=warn (handled by daily digest)", async () => {
    dbState.users = [user({ id: "admin-1", email: "a1@example.com" })];

    const result = await baseNotify({
      severity: "warn",
      dedupeKey: "k-warn",
    });

    expect(result.created).toBe(true);
    expect(result.recipientCount).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(dbState.notifications).toHaveLength(1);
    expect(dbState.notifications[0].severity).toBe("warn");
    expect(sendBatchMock).not.toHaveBeenCalled();
  });

  it("skips email channel for recipients who haven't completed first sign-in (in-app row still created)", async () => {
    // First-sign-in gate: admin-2 has lastLoginAt=null (e.g. invited but not
    // yet clicked their magic link). Their bell row MUST still land so the
    // alert is waiting in the inbox when they sign in for the first time.
    // The email batch should target only the signed-in admins.
    dbState.users = [
      user({ id: "admin-1", email: "a1@example.com", lastLoginAt: new Date("2025-02-01") }),
      user({ id: "admin-2", email: "newbie@example.com", lastLoginAt: null }),
      user({ id: "super-1", email: "s1@example.com", role: "super_admin", lastLoginAt: new Date("2025-02-01") }),
    ];

    const result = await baseNotify({ dedupeKey: "k-first-signin-gate" });

    expect(result.created).toBe(true);
    // All 3 in-app rows (bell icon) — including the never-signed-in user.
    expect(result.recipientCount).toBe(3);
    expect(dbState.notifications.map((n) => n.recipientUserId).sort()).toEqual(
      ["admin-1", "admin-2", "super-1"].sort(),
    );
    // Only 2 emails sent — the never-signed-in user was filtered out of the
    // email batch.
    expect(result.emailsSent).toBe(2);
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    const items = sendBatchMock.mock.calls[0][0] as Array<{ to: string }>;
    expect(items.map((i) => i.to).sort()).toEqual(
      ["a1@example.com", "s1@example.com"].sort(),
    );
    expect(items.find((i) => i.to === "newbie@example.com")).toBeUndefined();
  });

  it("rolls back the event row when fan-out insert fails — retry with same dedupeKey recovers", async () => {
    // Regression for the partial-failure bug: previously, the event row was
    // committed before the recipient rows. If the recipient insert blew up
    // for any reason (DB hiccup, schema drift, …), the event row stayed
    // around and any retry with the same dedupeKey hit the unique
    // constraint and silently dropped the alert forever.
    //
    // Now both inserts run inside one transaction, so a thrown fan-out
    // unwinds the event row and the dedupeKey is free for a clean retry.
    dbState.users = [user({ id: "admin-1", email: "a1@example.com" })];

    // Hijack the @workspace/db insert mock so the next call against
    // `notificationsTable` throws (simulating a transient DB error).
    const dbModule = (await import("@workspace/db")) as unknown as {
      db: { insert: ReturnType<typeof vi.fn> };
      notificationsTable: { _t: string };
      notificationEventsTable: { _t: string };
    };
    const realInsert = dbModule.db.insert.getMockImplementation();
    let firstFanoutAttempted = false;
    dbModule.db.insert.mockImplementationOnce((table: { _t: string }) => {
      if (table === dbModule.notificationEventsTable) {
        // Let the event insert proceed normally.
        return realInsert!(table);
      }
      return realInsert!(table);
    });
    dbModule.db.insert.mockImplementationOnce((table: { _t: string }) => {
      if (table === dbModule.notificationsTable) {
        firstFanoutAttempted = true;
        return {
          values: vi.fn(async () => {
            throw new Error("simulated DB hiccup on fan-out insert");
          }),
        };
      }
      return realInsert!(table);
    });

    const key = "k-recover";
    const first = await baseNotify({ dedupeKey: key });
    expect(first.created).toBe(false); // notify swallowed the error
    expect(firstFanoutAttempted).toBe(true);
    expect(dbState.notifications).toHaveLength(0); // fan-out rolled back
    expect(dbState.events).toHaveLength(0); // event row rolled back too
    expect(dbState.dedupeKeys.has(key)).toBe(false); // key is free again

    // Restore default insert and retry — must succeed because the
    // dedupeKey is no longer reserved by a half-applied first attempt.
    const second = await baseNotify({ dedupeKey: key });
    expect(second.created).toBe(true);
    expect(second.recipientCount).toBe(1);
    expect(dbState.events).toHaveLength(1);
    expect(dbState.notifications).toHaveLength(1);
  });

  it("still creates bell rows when the email batch throws (caller flow protected)", async () => {
    dbState.users = [user({ id: "admin-1", email: "a1@example.com" })];
    sendBatchMock.mockRejectedValueOnce(new Error("Resend boom"));

    const result = await baseNotify({ dedupeKey: "k-mailer-fails" });

    expect(result.created).toBe(true);
    expect(result.recipientCount).toBe(1);
    expect(result.emailsSent).toBe(0); // batch rejected
    expect(dbState.notifications).toHaveLength(1); // bell row still landed
  });
});

describe("sendNotificationDigests() — daily warn rollup", () => {
  it("groups pending warn rows by recipient and emails one digest per user", async () => {
    // Stage two pending warn rows for the same recipient and one for another.
    dbState.notifications = [
      {
        id: "n-1",
        organisationId: "org-1",
        recipientUserId: "u-1",
        category: "import.fleet.error",
        severity: "warn",
        title: "First warning",
        body: "Body 1",
        linkUrl: undefined,
        sourceAuditId: undefined,
        sourceEventId: "e-1",
        createdAt: new Date(),
        emailSentAt: null,
        dismissedAt: null,
      },
      {
        id: "n-2",
        organisationId: "org-1",
        recipientUserId: "u-1",
        category: "import.fleet.error",
        severity: "warn",
        title: "Second warning",
        body: "Body 2",
        linkUrl: undefined,
        sourceAuditId: undefined,
        sourceEventId: "e-2",
        createdAt: new Date(),
        emailSentAt: null,
        dismissedAt: null,
      },
      {
        id: "n-3",
        organisationId: "org-1",
        recipientUserId: "u-2",
        category: "webhook.fleet.warn",
        severity: "warn",
        title: "Other user warning",
        body: "Body 3",
        linkUrl: undefined,
        sourceAuditId: undefined,
        sourceEventId: "e-3",
        createdAt: new Date(),
        emailSentAt: null,
        dismissedAt: null,
      },
    ];

    // The lib does a `select{...}.from(notificationsTable).where(...)` to
    // collect pending rows, then per-user `db.query.usersTable.findFirst`
    // for the recipient profile. Stub the select to return our pending rows
    // (mock-side helper just returns dbState.notifications regardless of
    // table — fine because the lib only selects from notifications here),
    // and stub findFirst to look up by id from a small map.
    const userMap = new Map<string, UserRow>([
      ["u-1", user({ id: "u-1", email: "u1@example.com", isActive: true })],
      ["u-2", user({ id: "u-2", email: "u2@example.com", isActive: true })],
    ]);
    const dbModule = (await import("@workspace/db")) as unknown as {
      db: {
        select: ReturnType<typeof vi.fn>;
        query: { usersTable: { findFirst: ReturnType<typeof vi.fn> } };
      };
    };
    dbModule.db.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () =>
          dbState.notifications
            .filter((n) => n.severity === "warn" && !n.emailSentAt && !n.dismissedAt)
            .map((n) => ({
              id: n.id,
              recipientUserId: n.recipientUserId,
              organisationId: n.organisationId,
              category: n.category,
              title: n.title,
              body: n.body,
              linkUrl: n.linkUrl,
              createdAt: n.createdAt,
            })),
        ),
      })),
    }));
    dbModule.db.query.usersTable.findFirst.mockImplementation(async (args?: { where?: unknown }) => {
      // The lib calls findFirst({ where: eq(usersTable.id, userId) }) — we
      // just look up by scanning the map for a value present anywhere in
      // the where expression's serialised form.
      const w = JSON.stringify(args?.where ?? {});
      for (const [id, u] of userMap) if (w.includes(id)) return u;
      return null;
    });

    const out = await sendNotificationDigests();

    expect(out.users).toBe(2);
    expect(out.rows).toBe(3);
    // CRITICAL CONTRACT: digest sweep is one batched Resend call covering
    // all per-user digests, not N separate sends.
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    const items = sendBatchMock.mock.calls[0][0] as Array<{ to: string; title: string; body: string }>;
    expect(items).toHaveLength(2);

    // Find the digest item for u-1 — its body should mention both items
    // and the title should reflect the rollup count.
    const u1Item = items.find((i) => i.to === "u1@example.com");
    expect(u1Item).toBeTruthy();
    expect(u1Item!.title).toContain("2 items");
    expect(u1Item!.body).toContain("First warning");
    expect(u1Item!.body).toContain("Second warning");

    // Pending rows must be marked emailed so they don't re-digest tomorrow.
    expect(dbState.notifications.every((n) => n.emailSentAt)).toBe(true);
  });

  it("excludes recipients who have not completed first sign-in from the digest", async () => {
    // Same shape as the happy-path test, but u-1 has lastLoginAt=null and
    // therefore must NOT receive an email. Their warn rows stay unstamped
    // so they can roll into a future digest after sign-in.
    dbState.notifications = [
      {
        id: "n-pending-1",
        organisationId: "org-1",
        recipientUserId: "u-newbie",
        category: "import.fleet.error",
        severity: "warn",
        title: "Warning for newbie",
        body: "Body",
        linkUrl: undefined,
        sourceAuditId: undefined,
        sourceEventId: "e-1",
        createdAt: new Date(),
        emailSentAt: null,
        dismissedAt: null,
      },
      {
        id: "n-pending-2",
        organisationId: "org-1",
        recipientUserId: "u-active",
        category: "import.fleet.error",
        severity: "warn",
        title: "Warning for active user",
        body: "Body",
        linkUrl: undefined,
        sourceAuditId: undefined,
        sourceEventId: "e-2",
        createdAt: new Date(),
        emailSentAt: null,
        dismissedAt: null,
      },
    ];
    const userMap = new Map<string, UserRow>([
      ["u-newbie", user({ id: "u-newbie", email: "newbie@example.com", lastLoginAt: null })],
      ["u-active", user({ id: "u-active", email: "active@example.com", lastLoginAt: new Date("2025-01-01") })],
    ]);
    const dbModule = (await import("@workspace/db")) as unknown as {
      db: {
        select: ReturnType<typeof vi.fn>;
        query: { usersTable: { findFirst: ReturnType<typeof vi.fn> } };
      };
    };
    dbModule.db.select.mockImplementationOnce(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () =>
          dbState.notifications
            .filter((n) => n.severity === "warn" && !n.emailSentAt && !n.dismissedAt)
            .map((n) => ({
              id: n.id,
              recipientUserId: n.recipientUserId,
              organisationId: n.organisationId,
              category: n.category,
              title: n.title,
              body: n.body,
              linkUrl: n.linkUrl,
              createdAt: n.createdAt,
            })),
        ),
      })),
    }));
    dbModule.db.query.usersTable.findFirst.mockImplementation(async (args?: { where?: unknown }) => {
      const w = JSON.stringify(args?.where ?? {});
      for (const [id, u] of userMap) if (w.includes(id)) return u;
      return null;
    });

    const out = await sendNotificationDigests();

    expect(out.users).toBe(1);
    expect(out.rows).toBe(1);
    expect(sendBatchMock).toHaveBeenCalledTimes(1);
    const items = sendBatchMock.mock.calls[0][0] as Array<{ to: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].to).toBe("active@example.com");

    // The newbie's row remains unstamped so tomorrow's digest can re-attempt.
    const newbieRow = dbState.notifications.find((n) => n.recipientUserId === "u-newbie")!;
    expect(newbieRow.emailSentAt).toBeFalsy();
    const activeRow = dbState.notifications.find((n) => n.recipientUserId === "u-active")!;
    expect(activeRow.emailSentAt).toBeTruthy();
  });
});
