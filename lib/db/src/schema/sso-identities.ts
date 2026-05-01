import { pgTable, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Links an EnviroIQ user record to a verified Google or Microsoft identity.
 * Written on first successful SSO sign-in for a given (provider, sub) pair.
 * Subsequent sign-ins look the user up by (provider, providerSub) directly,
 * which means a user can change their email at the IdP and we still match.
 */
export const ssoIdentitiesTable = pgTable(
  "sso_identities",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    /** "google" | "microsoft" */
    provider: text("provider").notNull(),
    /** OIDC subject — stable, opaque per provider. */
    providerSub: text("provider_sub").notNull(),
    /** Email at the time of linking; informational only. */
    providerEmail: text("provider_email").notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    providerSubUnique: uniqueIndex("sso_identities_provider_sub_uq").on(t.provider, t.providerSub),
    userIdx: index("sso_identities_user_idx").on(t.userId),
  }),
);

export const insertSsoIdentitySchema = createInsertSchema(ssoIdentitiesTable).omit({
  linkedAt: true,
  lastUsedAt: true,
});
export type InsertSsoIdentity = z.infer<typeof insertSsoIdentitySchema>;
export type SsoIdentity = typeof ssoIdentitiesTable.$inferSelect;
