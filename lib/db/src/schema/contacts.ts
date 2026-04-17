import { pgTable, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// FGC standard: Contact entity. People at a customer who are not necessarily
// app users — billing contacts, technical contacts, procurement, executives.
export const contactsTable = pgTable("contacts", {
  id: text("id").primaryKey(),
  organisationId: text("organisation_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  jobTitle: text("job_title"),
  email: text("email").notNull(),
  mobile: text("mobile"),
  phone: text("phone"),
  department: text("department"),
  // FGC role values: billing | technical | procurement | executive | support
  roleInCustomerBusiness: text("role_in_customer_business"),
  isPrimaryContact: boolean("is_primary_contact").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  preferredCommunicationMethod: text("preferred_communication_method"),
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  escalationLevel: text("escalation_level"),
  isAfterHoursContact: boolean("is_after_hours_contact").notNull().default(false),
  notes: text("notes"),
  sourceSystem: text("source_system"),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContactSchema = createInsertSchema(contactsTable).omit({
  createdAt: true,
  updatedAt: true,
});

export type InsertContact = z.infer<typeof insertContactSchema>;
export type Contact = typeof contactsTable.$inferSelect;
