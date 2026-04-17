import { pgTable, text, integer, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

// FGC: Idempotency-Key support for create/update endpoints.
// On replay with same key + same body hash, return the cached response.
// On replay with same key + different body, return 409 Conflict.
// On replay while the original request is still in flight (response_status = 0),
// return 409 with in_flight: true.
export const idempotencyKeysTable = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(), // random uuid; uniqueness enforced by (scope, key)
    scope: text("scope").notNull(), // "crm:<keyId>:<METHOD>:<path>"
    key: text("key").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    bodyHash: text("body_hash").notNull(),
    responseStatus: integer("response_status").notNull(), // 0 = in-flight placeholder
    responseBody: text("response_body").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeKeyUnique: uniqueIndex("idempotency_keys_scope_key_unique").on(t.scope, t.key),
    expiresIdx: index("idempotency_keys_expires_idx").on(t.expiresAt),
  }),
);

export type IdempotencyKey = typeof idempotencyKeysTable.$inferSelect;
