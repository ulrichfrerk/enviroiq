import { pgTable, text, timestamp, jsonb, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// FGC: Subscription / Plan entity
export const subscriptionsTable = pgTable("subscriptions", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  planCode: text("plan_code").notNull(),
  // FGC status: active | pending | suspended | disabled | archived | cancelled
  status: text("status").notNull().default("active"),
  pricingTier: text("pricing_tier"),
  supportTier: text("support_tier"),
  contractStatus: text("contract_status"),
  billingStatus: text("billing_status"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull().defaultNow(),
  endDate: timestamp("end_date", { withTimezone: true }),
  renewalDate: timestamp("renewal_date", { withTimezone: true }),
  isCreditHold: jsonb("is_credit_hold").$type<boolean>(),
  entitlements: jsonb("entitlements").$type<Record<string, unknown>>(),
  addons: jsonb("addons").$type<string[]>(),
  monthlyPrice: real("monthly_price"),
  currency: text("currency").notNull().default("NZD"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancelReason: text("cancel_reason"),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspendReason: text("suspend_reason"),
  sourceSystem: text("source_system"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSubscriptionSchema = createInsertSchema(subscriptionsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Subscription = typeof subscriptionsTable.$inferSelect;
