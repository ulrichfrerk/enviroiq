import { pgTable, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").notNull().default("org_viewer"),
  organisationId: text("organisation_id"),
  isActive: boolean("is_active").notNull().default(true),
  /**
   * Clerk user ID, set on a user's first sign-in via Clerk.
   * Pre-existing (passkey-era) users have this NULL until they first sign in
   * with Clerk; matching is then performed by email and this column is filled.
   */
  clerkUserId: text("clerk_user_id").unique(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  // Per-user sign-in policy override ─────────────────────────────────────────
  // When set, these supersede the equivalent organisation-level policy. This
  // lets admins say things like "Finance team must use Microsoft" while the
  // rest of the org follows the org default.
  //
  // requiredSignInProvider:
  //   NULL        → inherit org.requiredSsoProvider
  //   "none"      → explicitly clear the org-level requirement for this user
  //   "google"    → this user MUST sign in via Google
  //   "microsoft" → this user MUST sign in via Microsoft
  //
  // allowedSignInMethods:
  //   NULL        → inherit org.allowedSignInMethods
  //   array       → use this user-specific allow list
  //
  // Org-level master switches (googleSsoEnabled / microsoftSsoEnabled) and
  // the org_admin magic-link break-glass still apply.
  requiredSignInProvider: text("required_sign_in_provider"),
  allowedSignInMethods: jsonb("allowed_sign_in_methods").$type<
    ("magic_link" | "passkey" | "google_sso" | "microsoft_sso")[]
  >(),
  // Per-user opt-in for system-generated email notifications (daily ESG data
  // quality digest, scheduled reminders, stale sign-in digest, etc.). Default
  // is OFF — admins explicitly turn this on from their Account page when they
  // want EnviroIQ to start emailing them. The bell icon / in-app notification
  // history is unaffected by this flag, only the email channel.
  emailNotificationsEnabled: boolean("email_notifications_enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const passkeysTable = pgTable("passkeys", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  credentialId: text("credential_id").notNull().unique(),
  credentialPublicKey: text("credential_public_key").notNull(),
  counter: text("counter").notNull().default("0"),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up").notNull().default(false),
  transports: text("transports"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // Bumped on each successful passkey authentication. NULL means the passkey
  // has been enrolled but never used to sign in — surfaced on the Account
  // page so users can spot and remove stale or unused devices.
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  // User-supplied friendly name (e.g. "MacBook Pro", "iPhone 15"). Nullable
  // because passkeys enrolled before this column existed have no label —
  // the UI falls back to the deviceType-derived default ("Device passkey" /
  // "Synced passkey") in that case.
  label: text("label"),
});

export const magicLinksTable = pgTable("magic_links", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webAuthnChallengesTable = pgTable("webauthn_challenges", {
  id: text("id").primaryKey(),
  challenge: text("challenge").notNull(),
  email: text("email"),
  type: text("type").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type Passkey = typeof passkeysTable.$inferSelect;
