import { pgTable, text, timestamp, jsonb, real, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// FGC: Billing Profile entity
export const billingProfilesTable = pgTable("billing_profiles", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull().unique(),
  billingLegalEntityName: text("billing_legal_entity_name"),
  billingContactId: text("billing_contact_id"),
  billingEmail: text("billing_email"),
  accountsPayableEmail: text("accounts_payable_email"),
  invoiceEmail: text("invoice_email"),
  purchaseOrderNumber: text("purchase_order_number"),
  taxNumber: text("tax_number"),
  billingAddress: jsonb("billing_address").$type<Record<string, unknown>>(),
  shippingAddress: jsonb("shipping_address").$type<Record<string, unknown>>(),
  currency: text("currency").notNull().default("NZD"),
  paymentTerms: text("payment_terms"),
  // NEVER store raw card numbers — only a payment gateway token reference
  paymentMethodToken: text("payment_method_token"),
  directDebitStatus: text("direct_debit_status"),
  invoiceDeliveryMethod: text("invoice_delivery_method"),
  invoiceGroupingRules: jsonb("invoice_grouping_rules").$type<Record<string, unknown>>(),
  statementCycle: text("statement_cycle"),
  suspensionThreshold: real("suspension_threshold"),
  collectionsStatus: text("collections_status"),
  isCreditHold: boolean("is_credit_hold").notNull().default(false),
  creditHoldReason: text("credit_hold_reason"),
  creditHoldAt: timestamp("credit_hold_at", { withTimezone: true }),
  sourceSystem: text("source_system"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBillingProfileSchema = createInsertSchema(billingProfilesTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertBillingProfile = z.infer<typeof insertBillingProfileSchema>;
export type BillingProfile = typeof billingProfilesTable.$inferSelect;
