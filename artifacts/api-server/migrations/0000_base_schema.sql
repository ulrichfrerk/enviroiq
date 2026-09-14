-- Base application schema generated from lib/db/src/schema with drizzle-kit
-- (2026-09-14) and made idempotent. Applied first by the `migrate` Lambda
-- (src/aws/handlers.ts); the runtime self-heal chain (src/schema-bootstrap.ts)
-- runs after it and verify-schema confirms the result.

CREATE TABLE IF NOT EXISTS "organisations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"legal_entity_name" text,
	"trading_name" text,
	"company_number" text,
	"gst_vat_tax_number" text,
	"industry" text,
	"country" text,
	"logo_url" text,
	"account_type" text DEFAULT 'active_customer' NOT NULL,
	"account_owner" text,
	"account_manager" text,
	"commercial_status" text,
	"onboarding_status" text,
	"risk_rating" text,
	"support_tier" text,
	"contract_start_date" timestamp with time zone,
	"contract_end_date" timestamp with time zone,
	"renewal_date" timestamp with time zone,
	"parent_account_id" text,
	"notes" text,
	"tags" jsonb,
	"credit_limit" real,
	"payment_terms" text,
	"preferred_currency" text DEFAULT 'NZD' NOT NULL,
	"default_timezone" text DEFAULT 'Pacific/Auckland' NOT NULL,
	"default_language" text DEFAULT 'en-NZ' NOT NULL,
	"fy_start_month" integer DEFAULT 4 NOT NULL,
	"privacy_classification" text,
	"security_classification" text,
	"dpa_nda_status" text,
	"trust_framework_status" text,
	"compliance_status" text,
	"suspension_reason" text,
	"suspended_at" timestamp with time zone,
	"suspended_by" text,
	"archived_at" timestamp with time zone,
	"widget_key" text NOT NULL,
	"webhook_secret" text,
	"inbound_email_address" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"require_mfa" boolean DEFAULT false NOT NULL,
	"data_residency" text DEFAULT 'NZ' NOT NULL,
	"document_archive_retention_months" integer DEFAULT 6 NOT NULL,
	"google_sso_enabled" boolean DEFAULT true NOT NULL,
	"microsoft_sso_enabled" boolean DEFAULT true NOT NULL,
	"allowed_sign_in_methods" jsonb DEFAULT '["magic_link","passkey","google_sso","microsoft_sso"]'::jsonb NOT NULL,
	"required_sso_provider" text,
	"esg_fleet_co2e_kg" real,
	"esg_energy_co2e_kg" real,
	"esg_total_co2e_kg" real,
	"esg_energy_kwh" real,
	"esg_sustainability_score" real,
	"esg_computed_at" timestamp with time zone,
	"plan" text,
	"billing_status" text DEFAULT 'active' NOT NULL,
	"source_system" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organisations_widget_key_unique" UNIQUE("widget_key"),
	CONSTRAINT "organisations_inbound_email_address_unique" UNIQUE("inbound_email_address")
);

CREATE TABLE IF NOT EXISTS "magic_links" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"code_hash" text,
	"code_attempts" integer DEFAULT 0 NOT NULL,
	"code_used_at" timestamp with time zone,
	CONSTRAINT "magic_links_token_unique" UNIQUE("token")
);

CREATE TABLE IF NOT EXISTS "passkeys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"credential_id" text NOT NULL,
	"credential_public_key" text NOT NULL,
	"counter" text DEFAULT '0' NOT NULL,
	"device_type" text,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"label" text,
	CONSTRAINT "passkeys_credential_id_unique" UNIQUE("credential_id")
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'org_viewer' NOT NULL,
	"organisation_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"clerk_user_id" text,
	"last_login_at" timestamp with time zone,
	"required_sign_in_provider" text,
	"allowed_sign_in_methods" jsonb,
	"email_notifications_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);

CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
	"id" text PRIMARY KEY NOT NULL,
	"challenge" text NOT NULL,
	"email" text,
	"type" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "sso_identities" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_sub" text NOT NULL,
	"provider_email" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "fleet_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"vehicle_id" text NOT NULL,
	"event_type" text NOT NULL,
	"latitude" real,
	"longitude" real,
	"speed_kmh" real,
	"distance_km" real,
	"fuel_litres" real,
	"co2e_kg" real,
	"cost_nzd" real,
	"unit_cost_nzd_per_litre" real,
	"source" text NOT NULL,
	"raw_payload" text,
	"emission_factor_id" text,
	"import_batch_id" text,
	"ingested_by_user_id" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"registration" text,
	"make" text,
	"model" text,
	"year" integer,
	"fuel_type" text DEFAULT 'petrol' NOT NULL,
	"emission_factor_kg_per_km" real,
	"fuel_consumption_l_per_100km" real,
	"monthly_fixed_cost_nzd" real,
	"gps_provider" text DEFAULT 'none',
	"gps_device_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "energy_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"utility_type" text NOT NULL,
	"provider" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"usage_kwh" real,
	"usage_mj" real,
	"cost_amount" real,
	"cost_currency" text DEFAULT 'NZD',
	"co2e_kg" real,
	"grid_intensity_kg_co2_per_kwh" real,
	"emission_method" text,
	"emission_note" text,
	"supplier_renewable_pct" real,
	"source" text DEFAULT 'manual' NOT NULL,
	"original_file_name" text,
	"raw_text" text,
	"emission_factor_id" text,
	"import_batch_id" text,
	"ingested_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "goals" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"target_type" text NOT NULL,
	"target_value" real NOT NULL,
	"target_unit" text NOT NULL,
	"baseline_value" real,
	"baseline_year" integer,
	"target_year" integer,
	"due_date" timestamp with time zone,
	"status" text DEFAULT 'not_started' NOT NULL,
	"is_public" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"title" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"report_type" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"data_snapshot" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "widget_configs" (
	"organisation_id" text PRIMARY KEY NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"title" text,
	"show_total_co2e" boolean DEFAULT true NOT NULL,
	"show_fleet_stats" boolean DEFAULT true NOT NULL,
	"show_energy_usage" boolean DEFAULT true NOT NULL,
	"show_goals" boolean DEFAULT true NOT NULL,
	"show_sustainability_score" boolean DEFAULT true NOT NULL,
	"show_last_updated" boolean DEFAULT true NOT NULL,
	"accent_color" text DEFAULT '#22c55e',
	"theme" text DEFAULT 'light',
	"period" text DEFAULT 'month',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text,
	"user_id" text,
	"user_email" text,
	"actor_type" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"ip_address" text,
	"user_agent" text,
	"details" text,
	"previous_value" jsonb,
	"new_value" jsonb,
	"reason_code" text,
	"correlation_id" text,
	"source_system" text,
	"outcome" text DEFAULT 'success' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"provider" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "grid_intensity_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'em6' NOT NULL,
	"region" text DEFAULT 'NZ' NOT NULL,
	"trading_period_start" timestamp with time zone NOT NULL,
	"gco2_per_kwh" real NOT NULL,
	"renewable_pct" real,
	"carbon_tonnes" real,
	"raw_json" jsonb,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "emission_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"baseline_year" integer NOT NULL,
	"baseline_co2e_kg" real NOT NULL,
	"target_year" integer NOT NULL,
	"target_pct_reduction" real NOT NULL,
	"label" text,
	"framework" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"levers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "hs_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"incident_date" timestamp with time zone NOT NULL,
	"incident_type" text NOT NULL,
	"description" text,
	"days_lost" integer DEFAULT 0,
	"hours_worked_at_time" real,
	"reported_by" text,
	"closed_out" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "social_workforce_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"headcount" integer,
	"fte_count" real,
	"contractor_count" integer,
	"turnover_pct" real,
	"female_pct" real,
	"female_leadership_pct" real,
	"pay_equity_gap_pct" real,
	"living_wage_accredited" boolean DEFAULT false,
	"local_supplier_pct" real,
	"volunteer_hours" real,
	"charity_donation_nzd" real,
	"modern_slavery_compliant" boolean DEFAULT false,
	"supplier_code_of_conduct" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "training_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"employee_name" text NOT NULL,
	"training_date" timestamp with time zone NOT NULL,
	"topic" text NOT NULL,
	"hours" real NOT NULL,
	"provider" text,
	"category" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "governance_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"period_year" integer NOT NULL,
	"board_size" integer,
	"board_independent_count" integer,
	"board_female_count" integer,
	"board_meetings_per_year" integer,
	"has_audit_committee" boolean DEFAULT false,
	"has_code_of_conduct" boolean DEFAULT false,
	"has_whistleblower" boolean DEFAULT false,
	"has_anti_bribery" boolean DEFAULT false,
	"has_privacy_policy" boolean DEFAULT false,
	"has_cyber_framework" boolean DEFAULT false,
	"has_esg_risk_register" boolean DEFAULT false,
	"has_tcfd_aligned" boolean DEFAULT false,
	"has_external_assurance" boolean DEFAULT false,
	"has_modern_slavery_policy" boolean DEFAULT false,
	"framework_alignment" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"name" text NOT NULL,
	"contract_number" text,
	"client_name" text,
	"site_address" text,
	"contract_value_nzd" real,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"description" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "environmental_incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"project_id" text,
	"incident_date" timestamp with time zone NOT NULL,
	"incident_type" text NOT NULL,
	"description" text NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"reported_to_regulator" boolean DEFAULT false,
	"corrective_action" text,
	"closed_out" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "waste_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"project_id" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"waste_type" text NOT NULL,
	"quantity_kg" real NOT NULL,
	"disposal_method" text NOT NULL,
	"diverted" boolean DEFAULT false NOT NULL,
	"site_or_location" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "water_readings" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"project_id" text,
	"reading_date" timestamp with time zone NOT NULL,
	"cubic_metres" real NOT NULL,
	"meter_ref" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subcontractor_hs_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"subcontractor_id" text NOT NULL,
	"project_id" text,
	"record_date" timestamp with time zone NOT NULL,
	"record_type" text NOT NULL,
	"description" text,
	"compliant" boolean DEFAULT true,
	"corrective_action" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subcontractors" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"trade_type" text,
	"hs_prequalified" boolean DEFAULT false,
	"hs_expiry_date" timestamp with time zone,
	"supplier_code_signed" boolean DEFAULT false,
	"supplier_code_signed_date" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "advisor_cache" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"insights_json" text NOT NULL,
	"org_context_json" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"generated_by" text,
	CONSTRAINT "advisor_cache_organisation_id_unique" UNIQUE("organisation_id")
);

CREATE TABLE IF NOT EXISTS "emission_factors" (
	"id" text PRIMARY KEY NOT NULL,
	"factor_key" text NOT NULL,
	"version" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"value" real NOT NULL,
	"unit" text NOT NULL,
	"category" text NOT NULL,
	"source" text NOT NULL,
	"methodology" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"audit_id" text NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"payload" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_audit_files" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"audit_id" text NOT NULL,
	"question_id" text,
	"filename" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"content_base64" text NOT NULL,
	"uploaded_by_email" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_audit_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text,
	"name" text NOT NULL,
	"description" text,
	"version" integer DEFAULT 1 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"weight_environmental" integer DEFAULT 35 NOT NULL,
	"weight_social" integer DEFAULT 20 NOT NULL,
	"weight_governance" integer DEFAULT 25 NOT NULL,
	"weight_supply_chain" integer DEFAULT 20 NOT NULL,
	"schema" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email" text NOT NULL,
	"recipient_name" text,
	"responses" text,
	"score_breakdown" text,
	"flags" text,
	"esg_score" real,
	"risk_level" text,
	"sent_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" text,
	"due_at" timestamp with time zone NOT NULL,
	"expired_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"declaration_name" text,
	"declaration_role" text,
	"declaration_confirmed" boolean DEFAULT false NOT NULL,
	"declaration_date" timestamp with time zone,
	"reminders_sent" text,
	"top_risk_answer" text,
	"support_needed_answer" text,
	"willing_to_align_answer" text,
	"questions_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_portal_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text,
	"company_number" text,
	"country" text,
	"industry" text,
	"description" text,
	"primary_contact_name" text,
	"primary_contact_email" text,
	"primary_contact_phone" text,
	"secondary_contact_name" text,
	"secondary_contact_email" text,
	"senior_responsible_officer" text,
	"shipping_method" text,
	"shipping_companies" text,
	"regions_supplied" text,
	"material_type" text,
	"risk_tag" text DEFAULT 'medium' NOT NULL,
	"is_critical" boolean DEFAULT false NOT NULL,
	"audit_frequency_months" integer DEFAULT 12 NOT NULL,
	"last_audit_at" timestamp with time zone,
	"next_audit_due_at" timestamp with time zone,
	"latest_esg_score" real,
	"latest_risk_level" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "supplier_audit_question_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"template_id" text NOT NULL,
	"question_id" text NOT NULL,
	"supplier_id" text,
	"enabled" boolean NOT NULL,
	"rationale_snapshot" text NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"job_title" text,
	"email" text NOT NULL,
	"mobile" text,
	"phone" text,
	"department" text,
	"role_in_customer_business" text,
	"is_primary_contact" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"preferred_communication_method" text,
	"marketing_consent" boolean DEFAULT false NOT NULL,
	"escalation_level" text,
	"is_after_hours_contact" boolean DEFAULT false NOT NULL,
	"notes" text,
	"source_system" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"plan_code" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"pricing_tier" text,
	"support_tier" text,
	"contract_status" text,
	"billing_status" text,
	"start_date" timestamp with time zone DEFAULT now() NOT NULL,
	"end_date" timestamp with time zone,
	"renewal_date" timestamp with time zone,
	"is_credit_hold" jsonb,
	"entitlements" jsonb,
	"addons" jsonb,
	"monthly_price" real,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"suspended_at" timestamp with time zone,
	"suspend_reason" text,
	"source_system" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "billing_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"billing_legal_entity_name" text,
	"billing_contact_id" text,
	"billing_email" text,
	"accounts_payable_email" text,
	"invoice_email" text,
	"purchase_order_number" text,
	"tax_number" text,
	"billing_address" jsonb,
	"shipping_address" jsonb,
	"currency" text DEFAULT 'NZD' NOT NULL,
	"payment_terms" text,
	"payment_method_token" text,
	"direct_debit_status" text,
	"invoice_delivery_method" text,
	"invoice_grouping_rules" jsonb,
	"statement_cycle" text,
	"suspension_threshold" real,
	"collections_status" text,
	"is_credit_hold" boolean DEFAULT false NOT NULL,
	"credit_hold_reason" text,
	"credit_hold_at" timestamp with time zone,
	"source_system" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_profiles_organisation_id_unique" UNIQUE("organisation_id")
);

CREATE TABLE IF NOT EXISTS "provisioning_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text,
	"customer_id" text,
	"product_code" text NOT NULL,
	"service_instance_id" text,
	"environment" text DEFAULT 'production' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"request_payload" jsonb,
	"result_payload" jsonb,
	"error_message" text,
	"requested_by" text,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"correlation_id" text,
	"source_system" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"contact_id" text,
	"subject" text NOT NULL,
	"description" text,
	"category" text,
	"severity" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_to" text,
	"escalation_level" text,
	"escalated_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"resolution" text,
	"tags" jsonb,
	"external_ticket_id" text,
	"external_system" text,
	"source_system" text,
	"created_by" text,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"body_hash" text NOT NULL,
	"response_status" integer NOT NULL,
	"response_body" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "document_archives" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" "bytea",
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"captured_by_user_id" text,
	"captured_by_email" text,
	"retention_policy" text DEFAULT '6mo_default' NOT NULL,
	"sender_email" text,
	"purged_at" timestamp with time zone,
	"notes" text
);

CREATE TABLE IF NOT EXISTS "notification_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"source_audit_id" text,
	"context" jsonb,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"organisation_id" text NOT NULL,
	"recipient_user_id" text NOT NULL,
	"category" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_url" text,
	"source_audit_id" text,
	"source_event_id" text NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"email_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "sso_identities_provider_sub_uq" ON "sso_identities" USING btree ("provider","provider_sub");

CREATE INDEX IF NOT EXISTS "sso_identities_user_idx" ON "sso_identities" USING btree ("user_id");

CREATE UNIQUE INDEX IF NOT EXISTS "grid_intensity_snapshots_period_uniq" ON "grid_intensity_snapshots" USING btree ("source","region","trading_period_start");

CREATE INDEX IF NOT EXISTS "supplier_q_overrides_org_scope_idx" ON "supplier_audit_question_overrides" USING btree ("organisation_id","template_id","supplier_id");

CREATE INDEX IF NOT EXISTS "supplier_q_overrides_question_idx" ON "supplier_audit_question_overrides" USING btree ("organisation_id","template_id","question_id");

CREATE UNIQUE INDEX IF NOT EXISTS "idempotency_keys_scope_key_unique" ON "idempotency_keys" USING btree ("scope","key");

CREATE INDEX IF NOT EXISTS "idempotency_keys_expires_idx" ON "idempotency_keys" USING btree ("expires_at");

CREATE INDEX IF NOT EXISTS "doc_archives_org_idx" ON "document_archives" USING btree ("organisation_id","captured_at");

CREATE INDEX IF NOT EXISTS "doc_archives_expires_idx" ON "document_archives" USING btree ("expires_at");

CREATE INDEX IF NOT EXISTS "doc_archives_source_idx" ON "document_archives" USING btree ("source_type","source_id");

CREATE UNIQUE INDEX IF NOT EXISTS "notification_events_dedupe_key_uq" ON "notification_events" USING btree ("dedupe_key");

CREATE INDEX IF NOT EXISTS "notification_events_org_created_idx" ON "notification_events" USING btree ("organisation_id","created_at");

CREATE INDEX IF NOT EXISTS "notifications_recipient_created_idx" ON "notifications" USING btree ("recipient_user_id","created_at");

CREATE INDEX IF NOT EXISTS "notifications_org_created_idx" ON "notifications" USING btree ("organisation_id","created_at");
