/**
 * Public OpenAPI 3.1 spec for the EnviroIQ CRM Integration API.
 * Aligned to the FGC Customer Operations API Standard v1.
 *
 * No auth is required to fetch the spec — it documents how to authenticate.
 */
import { Router } from "express";
import { CRM_API_SCOPES, CRM_API_SCOPE_DESCRIPTIONS } from "../lib/crm-api-keys.js";
import { FGC_REASON_CODES } from "../lib/audit.js";

const router = Router();

router.get("/openapi.json", (_req, res) => {
  const baseUrl = `${process.env.APP_BASE_URL?.replace(/\/app\/?$/, "") ?? "https://enviroiq.net"}/api/v1`;

  const scopes: Record<string, string> = {};
  for (const s of CRM_API_SCOPES) scopes[s] = CRM_API_SCOPE_DESCRIPTIONS[s];

  const meta = {
    type: "object",
    required: ["timestamp", "version", "requestId"],
    properties: {
      timestamp: { type: "string", format: "date-time" },
      version: { type: "string", example: "v1" },
      requestId: { type: "string", description: "Echoes X-Correlation-ID" },
    },
  };

  const errorEnvelope = {
    type: "object",
    required: ["success", "error", "meta"],
    properties: {
      success: { type: "boolean", enum: [false] },
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: {
            type: "string",
            enum: [
              "BAD_REQUEST",
              "UNAUTHORIZED",
              "FORBIDDEN",
              "NOT_FOUND",
              "CONFLICT",
              "UNPROCESSABLE",
              "RATE_LIMITED",
              "INTERNAL_ERROR",
              "UPSTREAM_ERROR",
            ],
          },
          message: { type: "string" },
          details: {},
        },
      },
      meta,
    },
  };

  const okEnvelope = (dataSchema: object) => ({
    type: "object",
    required: ["success", "data", "meta"],
    properties: {
      success: { type: "boolean", enum: [true] },
      data: dataSchema,
      meta,
    },
  });

  const paginatedEnvelope = (itemSchema: object) => ({
    type: "object",
    required: ["success", "data", "pagination", "meta"],
    properties: {
      success: { type: "boolean", enum: [true] },
      data: { type: "array", items: itemSchema },
      pagination: {
        type: "object",
        required: ["page", "limit", "total", "totalPages", "hasMore"],
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
          hasMore: { type: "boolean" },
        },
      },
      meta,
    },
  });

  const reasonCode = {
    type: "string",
    enum: FGC_REASON_CODES,
    description: "FGC standard lifecycle reason code",
  };
  const lifecyclePayload = {
    type: "object",
    required: ["reason_code"],
    properties: {
      reason_code: reasonCode,
      reason_note: { type: "string", maxLength: 500 },
    },
  };

  const Customer = {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      slug: { type: "string" },
      legal_entity_name: { type: "string", nullable: true },
      trading_name: { type: "string", nullable: true },
      company_number: { type: "string", nullable: true },
      gst_vat_tax_number: { type: "string", nullable: true },
      industry: { type: "string", nullable: true },
      country: { type: "string", nullable: true },
      account_type: {
        type: "string",
        enum: ["prospect", "active_customer", "suspended", "closed"],
      },
      account_owner: { type: "string", nullable: true },
      account_manager: { type: "string", nullable: true },
      commercial_status: { type: "string", nullable: true },
      risk_rating: { type: "string", enum: ["low", "medium", "high"], nullable: true },
      support_tier: { type: "string", nullable: true },
      contract_start_date: { type: "string", format: "date-time", nullable: true },
      contract_end_date: { type: "string", format: "date-time", nullable: true },
      renewal_date: { type: "string", format: "date-time", nullable: true },
      parent_account_id: { type: "string", nullable: true },
      tags: { type: "array", items: { type: "string" } },
      credit_limit: { type: "number", nullable: true },
      payment_terms: { type: "string", nullable: true },
      preferred_currency: { type: "string", example: "NZD" },
      default_timezone: { type: "string", example: "Pacific/Auckland" },
      default_language: { type: "string", example: "en-NZ" },
      compliance_status: { type: "string", nullable: true },
      suspension_reason: { type: "string", nullable: true },
      suspended_at: { type: "string", format: "date-time", nullable: true },
      archived_at: { type: "string", format: "date-time", nullable: true },
      is_active: { type: "boolean" },
      data_residency: { type: "string", example: "NZ" },
      plan: { type: "string", nullable: true },
      billing_status: { type: "string" },
      sustainability_score: { type: "number", nullable: true },
      total_co2e_kg: { type: "number", nullable: true },
      source_system: { type: "string", nullable: true },
      version: { type: "integer" },
      created_by: { type: "string", nullable: true },
      updated_by: { type: "string", nullable: true },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  };

  const Contact = {
    type: "object",
    properties: {
      id: { type: "string" },
      customer_id: { type: "string" },
      first_name: { type: "string" },
      last_name: { type: "string" },
      email: { type: "string", format: "email" },
      job_title: { type: "string", nullable: true },
      mobile: { type: "string", nullable: true },
      phone: { type: "string", nullable: true },
      department: { type: "string", nullable: true },
      role_in_customer_business: {
        type: "string",
        enum: ["billing", "technical", "procurement", "executive", "support"],
        nullable: true,
      },
      is_primary_contact: { type: "boolean" },
      is_active: { type: "boolean" },
      preferred_communication_method: {
        type: "string",
        enum: ["email", "phone", "sms"],
        nullable: true,
      },
      marketing_consent: { type: "boolean" },
      escalation_level: { type: "string", nullable: true },
      is_after_hours_contact: { type: "boolean" },
      created_at: { type: "string", format: "date-time" },
      updated_at: { type: "string", format: "date-time" },
    },
  };

  const Subscription = {
    type: "object",
    properties: {
      id: { type: "string" },
      customer_id: { type: "string" },
      plan_code: { type: "string" },
      status: {
        type: "string",
        enum: ["active", "pending", "suspended", "disabled", "archived", "cancelled"],
      },
      pricing_tier: { type: "string", nullable: true },
      support_tier: { type: "string", nullable: true },
      start_date: { type: "string", format: "date-time" },
      end_date: { type: "string", format: "date-time", nullable: true },
      renewal_date: { type: "string", format: "date-time", nullable: true },
      monthly_price: { type: "number", nullable: true },
      currency: { type: "string", example: "NZD" },
      cancelled_at: { type: "string", format: "date-time", nullable: true },
      cancel_reason: { type: "string", nullable: true },
      addons: { type: "array", items: { type: "string" } },
      entitlements: { type: "object", additionalProperties: true, nullable: true },
    },
  };

  const BillingProfile = {
    type: "object",
    properties: {
      id: { type: "string" },
      customer_id: { type: "string" },
      billing_email: { type: "string", format: "email", nullable: true },
      accounts_payable_email: { type: "string", format: "email", nullable: true },
      invoice_email: { type: "string", format: "email", nullable: true },
      currency: { type: "string", example: "NZD" },
      payment_terms: { type: "string", nullable: true },
      payment_method_token: { type: "string", nullable: true },
      invoice_delivery_method: {
        type: "string",
        enum: ["email", "post", "portal"],
        nullable: true,
      },
      statement_cycle: {
        type: "string",
        enum: ["monthly", "quarterly", "annual"],
        nullable: true,
      },
      is_credit_hold: { type: "boolean" },
      credit_hold_reason: { type: "string", nullable: true },
    },
  };

  const ProvisioningRequest = {
    type: "object",
    properties: {
      id: { type: "string" },
      customer_id: { type: "string" },
      product_code: { type: "string" },
      environment: {
        type: "string",
        enum: ["production", "sandbox", "staging", "development"],
      },
      status: {
        type: "string",
        enum: ["pending", "provisioning", "active", "error", "cancelled"],
      },
      service_instance_id: { type: "string", nullable: true },
      correlation_id: { type: "string", nullable: true },
      created_at: { type: "string", format: "date-time" },
    },
  };

  const Ticket = {
    type: "object",
    properties: {
      id: { type: "string" },
      customer_id: { type: "string" },
      contact_id: { type: "string", nullable: true },
      subject: { type: "string" },
      description: { type: "string", nullable: true },
      severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
      status: {
        type: "string",
        enum: ["open", "in_progress", "waiting_on_customer", "resolved", "closed", "cancelled"],
      },
      assigned_to: { type: "string", nullable: true },
      escalation_level: { type: "string", nullable: true },
      escalated_at: { type: "string", format: "date-time", nullable: true },
      resolved_at: { type: "string", format: "date-time", nullable: true },
      created_at: { type: "string", format: "date-time" },
    },
  };

  const AuditEntry = {
    type: "object",
    properties: {
      id: { type: "string" },
      correlation_id: { type: "string", nullable: true },
      customer_id: { type: "string", nullable: true },
      user_id: { type: "string", nullable: true },
      user_email: { type: "string", nullable: true },
      actor_type: {
        type: "string",
        enum: ["user", "system", "api_key", "scheduler", "webhook"],
      },
      action: { type: "string", description: "Dotted event name, e.g. customer.suspended" },
      resource_type: { type: "string", nullable: true },
      resource_id: { type: "string", nullable: true },
      previous_value: {},
      new_value: {},
      reason_code: { type: "string", enum: FGC_REASON_CODES, nullable: true },
      source_system: { type: "string", nullable: true },
      outcome: { type: "string", enum: ["success", "failure"] },
      created_at: { type: "string", format: "date-time" },
    },
  };

  const errorResponses = {
    "400": { description: "Bad request", content: { "application/json": { schema: errorEnvelope } } },
    "401": { description: "Unauthorized", content: { "application/json": { schema: errorEnvelope } } },
    "403": { description: "Forbidden", content: { "application/json": { schema: errorEnvelope } } },
    "404": { description: "Not found", content: { "application/json": { schema: errorEnvelope } } },
    "409": { description: "Conflict (idempotency or unique violation)", content: { "application/json": { schema: errorEnvelope } } },
    "422": { description: "Unprocessable entity", content: { "application/json": { schema: errorEnvelope } } },
    "429": { description: "Rate limited", content: { "application/json": { schema: errorEnvelope } } },
    "500": { description: "Internal error", content: { "application/json": { schema: errorEnvelope } } },
  };

  const headerParams = [
    {
      name: "X-Correlation-ID",
      in: "header",
      schema: { type: "string" },
      description: "Optional client-supplied correlation ID, echoed back and recorded in audit logs.",
    },
    {
      name: "Idempotency-Key",
      in: "header",
      schema: { type: "string" },
      description:
        "Optional on POST/PATCH/DELETE. Replaying with the same key returns the cached response (24h). Same key + different body = 409 CONFLICT.",
    },
  ];

  const lifecycleEndpoint = (path: string, summary: string, returns: object) => ({
    [path]: {
      post: {
        summary,
        tags: ["Customers"],
        security: [{ bearerAuth: ["customers:write"] }],
        parameters: headerParams,
        requestBody: {
          required: true,
          content: { "application/json": { schema: lifecyclePayload } },
        },
        responses: {
          "200": { description: "Updated", content: { "application/json": { schema: okEnvelope(returns) } } },
          ...errorResponses,
        },
      },
    },
  });

  res.json({
    openapi: "3.1.0",
    info: {
      title: "EnviroIQ CRM Integration API",
      version: "1.0.0",
      summary: "FGC Customer Operations API Standard v1",
      description: `
Programmatic API for the FGC sister CRM (or any compliant CRM) to manage
EnviroIQ customers, contacts, users, subscriptions, billing profiles,
provisioning requests and support tickets, and to query the audit log.

**FGC v1 conventions enforced:**
- All payloads (request and response) use snake_case.
- All responses use the standard envelope: \`{ success, data, meta, [pagination] }\`.
- Errors use \`{ success: false, error: { code, message, details? }, meta }\` with SCREAMING_SNAKE_CASE codes.
- Per-request correlation ID via \`X-Correlation-ID\` (auto-minted if absent), echoed back and stored in audit logs.
- Idempotent retries via \`Idempotency-Key\` on POST/PATCH/DELETE (24h replay window).
- Lifecycle actions (suspend / reactivate / archive / cancel / credit-hold / escalate) require a \`reason_code\` from the FGC enum.
- Audit events use dotted past-tense names: \`customer.created\`, \`subscription.cancelled\`, \`user.suspended\`, \`ticket.escalated\`, etc.

**Authentication:** Bearer API key (\`eiq_live_…\`) issued from the EnviroIQ
Super Admin portal. Each key has explicit scopes — see \`securitySchemes\`.
      `.trim(),
      contact: { name: "EnviroIQ Platform Team", email: "contact@frerkencompanies.com" },
    },
    servers: [{ url: baseUrl, description: "Production" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key (eiq_live_…)",
          description: `Available scopes:\n${Object.entries(scopes)
            .map(([k, v]) => `- \`${k}\`: ${v}`)
            .join("\n")}`,
        },
      },
      schemas: {
        Meta: meta,
        ErrorEnvelope: errorEnvelope,
        Customer,
        Contact,
        Subscription,
        BillingProfile,
        ProvisioningRequest,
        Ticket,
        AuditEntry,
        LifecyclePayload: lifecyclePayload,
      },
    },
    paths: {
      "/customers": {
        get: {
          summary: "List customers",
          tags: ["Customers"],
          security: [{ bearerAuth: ["customers:read"] }],
          parameters: [
            ...headerParams,
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
            { name: "q", in: "query", schema: { type: "string" }, description: "Search by name / slug / legal entity name" },
            { name: "account_type", in: "query", schema: { type: "string", enum: ["prospect", "active_customer", "suspended", "closed"] } },
            { name: "industry", in: "query", schema: { type: "string" } },
            { name: "country", in: "query", schema: { type: "string" } },
            { name: "sort", in: "query", schema: { type: "string", enum: ["created_at", "updated_at", "name"], default: "created_at" } },
            { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          ],
          responses: { "200": { description: "Paginated list", content: { "application/json": { schema: paginatedEnvelope(Customer) } } }, ...errorResponses },
        },
        post: {
          summary: "Create customer",
          tags: ["Customers"],
          security: [{ bearerAuth: ["customers:write"] }],
          parameters: headerParams,
          requestBody: { required: true, content: { "application/json": { schema: { allOf: [Customer, { required: ["name", "slug"] }] } } } },
          responses: { "201": { description: "Created", content: { "application/json": { schema: okEnvelope(Customer) } } }, ...errorResponses },
        },
      },
      "/customers/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: {
          summary: "Get customer",
          tags: ["Customers"],
          security: [{ bearerAuth: ["customers:read"] }],
          parameters: headerParams,
          responses: { "200": { description: "Customer", content: { "application/json": { schema: okEnvelope(Customer) } } }, ...errorResponses },
        },
        patch: {
          summary: "Update customer",
          tags: ["Customers"],
          security: [{ bearerAuth: ["customers:write"] }],
          parameters: headerParams,
          requestBody: { required: true, content: { "application/json": { schema: Customer } } },
          responses: { "200": { description: "Updated", content: { "application/json": { schema: okEnvelope(Customer) } } }, ...errorResponses },
        },
      },
      ...lifecycleEndpoint("/customers/{id}/suspend", "Suspend a customer (FGC lifecycle)", Customer),
      ...lifecycleEndpoint("/customers/{id}/reactivate", "Reactivate a suspended customer", Customer),
      ...lifecycleEndpoint("/customers/{id}/archive", "Archive (close) a customer", Customer),
      "/customers/{cid}/contacts": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }],
        get: {
          summary: "List contacts",
          tags: ["Contacts"],
          security: [{ bearerAuth: ["contacts:read"] }],
          parameters: headerParams,
          responses: { "200": { description: "Paginated list", content: { "application/json": { schema: paginatedEnvelope(Contact) } } }, ...errorResponses },
        },
        post: {
          summary: "Create contact",
          tags: ["Contacts"],
          security: [{ bearerAuth: ["contacts:write"] }],
          parameters: headerParams,
          requestBody: { required: true, content: { "application/json": { schema: Contact } } },
          responses: { "201": { description: "Created", content: { "application/json": { schema: okEnvelope(Contact) } } }, ...errorResponses },
        },
      },
      "/customers/{cid}/contacts/{id}": {
        parameters: [
          { name: "cid", in: "path", required: true, schema: { type: "string" } },
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        get: { summary: "Get contact", tags: ["Contacts"], security: [{ bearerAuth: ["contacts:read"] }], parameters: headerParams, responses: { "200": { description: "Contact", content: { "application/json": { schema: okEnvelope(Contact) } } }, ...errorResponses } },
        patch: { summary: "Update contact", tags: ["Contacts"], security: [{ bearerAuth: ["contacts:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: Contact } } }, responses: { "200": { description: "Updated", content: { "application/json": { schema: okEnvelope(Contact) } } }, ...errorResponses } },
        delete: { summary: "Delete contact", tags: ["Contacts"], security: [{ bearerAuth: ["contacts:write"] }], parameters: headerParams, responses: { "204": { description: "Deleted" }, ...errorResponses } },
      },
      "/customers/{cid}/users": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "List users", tags: ["Users"], security: [{ bearerAuth: ["users:read"] }], parameters: headerParams, responses: { "200": { description: "OK" }, ...errorResponses } },
        post: { summary: "Invite user", tags: ["Users"], security: [{ bearerAuth: ["users:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "name"], properties: { email: { type: "string", format: "email" }, name: { type: "string" }, role: { type: "string", enum: ["org_admin", "org_member", "org_viewer"] } } } } } }, responses: { "201": { description: "Created" }, ...errorResponses } },
      },
      "/customers/{cid}/users/{id}/suspend": { post: { summary: "Suspend user (FGC lifecycle)", tags: ["Users"], security: [{ bearerAuth: ["users:write"] }], parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }, ...headerParams], requestBody: { required: true, content: { "application/json": { schema: lifecyclePayload } } }, responses: { "200": { description: "Suspended" }, ...errorResponses } } },
      "/customers/{cid}/users/{id}/reactivate": { post: { summary: "Reactivate user", tags: ["Users"], security: [{ bearerAuth: ["users:write"] }], parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }, ...headerParams], requestBody: { required: true, content: { "application/json": { schema: lifecyclePayload } } }, responses: { "200": { description: "Reactivated" }, ...errorResponses } } },
      "/customers/{cid}/subscriptions": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "List subscriptions", tags: ["Subscriptions"], security: [{ bearerAuth: ["subscriptions:read"] }], parameters: headerParams, responses: { "200": { description: "Paginated list", content: { "application/json": { schema: paginatedEnvelope(Subscription) } } }, ...errorResponses } },
        post: { summary: "Create subscription", tags: ["Subscriptions"], security: [{ bearerAuth: ["subscriptions:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: Subscription } } }, responses: { "201": { description: "Created", content: { "application/json": { schema: okEnvelope(Subscription) } } }, ...errorResponses } },
      },
      "/customers/{cid}/subscriptions/{id}/cancel": { post: { summary: "Cancel subscription", tags: ["Subscriptions"], security: [{ bearerAuth: ["subscriptions:write"] }], parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }, ...headerParams], requestBody: { required: true, content: { "application/json": { schema: lifecyclePayload } } }, responses: { "200": { description: "Cancelled", content: { "application/json": { schema: okEnvelope(Subscription) } } }, ...errorResponses } } },
      "/customers/{cid}/billing-profile": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "Get billing profile", tags: ["Billing"], security: [{ bearerAuth: ["billing:read"] }], parameters: headerParams, responses: { "200": { description: "Profile", content: { "application/json": { schema: okEnvelope(BillingProfile) } } }, ...errorResponses } },
        put: { summary: "Upsert billing profile", tags: ["Billing"], security: [{ bearerAuth: ["billing:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: BillingProfile } } }, responses: { "200": { description: "Updated", content: { "application/json": { schema: okEnvelope(BillingProfile) } } }, ...errorResponses } },
      },
      "/customers/{cid}/billing-profile/credit-hold": {
        post: {
          summary: "Apply / release credit-hold",
          tags: ["Billing"],
          security: [{ bearerAuth: ["billing:write"] }],
          parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }, ...headerParams],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["on", "reason_code"],
                  properties: { on: { type: "boolean" }, reason_code: reasonCode, reason_note: { type: "string" } },
                },
              },
            },
          },
          responses: { "200": { description: "Updated", content: { "application/json": { schema: okEnvelope(BillingProfile) } } }, ...errorResponses },
        },
      },
      "/customers/{cid}/provisioning-requests": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "List provisioning requests", tags: ["Provisioning"], security: [{ bearerAuth: ["provisioning:read"] }], parameters: headerParams, responses: { "200": { description: "Paginated", content: { "application/json": { schema: paginatedEnvelope(ProvisioningRequest) } } }, ...errorResponses } },
        post: { summary: "Create provisioning request", tags: ["Provisioning"], security: [{ bearerAuth: ["provisioning:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: ProvisioningRequest } } }, responses: { "201": { description: "Created", content: { "application/json": { schema: okEnvelope(ProvisioningRequest) } } }, ...errorResponses } },
      },
      "/customers/{cid}/tickets": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }],
        get: { summary: "List tickets", tags: ["Tickets"], security: [{ bearerAuth: ["tickets:read"] }], parameters: headerParams, responses: { "200": { description: "Paginated", content: { "application/json": { schema: paginatedEnvelope(Ticket) } } }, ...errorResponses } },
        post: { summary: "Create ticket", tags: ["Tickets"], security: [{ bearerAuth: ["tickets:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: Ticket } } }, responses: { "201": { description: "Created", content: { "application/json": { schema: okEnvelope(Ticket) } } }, ...errorResponses } },
      },
      "/customers/{cid}/tickets/{id}": {
        parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }],
        patch: { summary: "Update ticket", tags: ["Tickets"], security: [{ bearerAuth: ["tickets:write"] }], parameters: headerParams, requestBody: { required: true, content: { "application/json": { schema: Ticket } } }, responses: { "200": { description: "Updated", content: { "application/json": { schema: okEnvelope(Ticket) } } }, ...errorResponses } },
      },
      "/customers/{cid}/tickets/{id}/escalate": {
        post: {
          summary: "Escalate ticket",
          tags: ["Tickets"],
          security: [{ bearerAuth: ["tickets:write"] }],
          parameters: [{ name: "cid", in: "path", required: true, schema: { type: "string" } }, { name: "id", in: "path", required: true, schema: { type: "string" } }, ...headerParams],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["escalation_level", "reason_code"],
                  properties: { escalation_level: { type: "string" }, reason_code: reasonCode, reason_note: { type: "string" } },
                },
              },
            },
          },
          responses: { "200": { description: "Escalated", content: { "application/json": { schema: okEnvelope(Ticket) } } }, ...errorResponses },
        },
      },
      "/audit": {
        get: {
          summary: "Query audit log (FGC standard)",
          tags: ["Audit"],
          security: [{ bearerAuth: ["audit:read"] }],
          parameters: [
            ...headerParams,
            { name: "customer_id", in: "query", schema: { type: "string" } },
            { name: "resource_type", in: "query", schema: { type: "string" } },
            { name: "resource_id", in: "query", schema: { type: "string" } },
            { name: "action", in: "query", schema: { type: "string" } },
            { name: "actor_type", in: "query", schema: { type: "string" } },
            { name: "reason_code", in: "query", schema: { type: "string" } },
            { name: "correlation_id", in: "query", schema: { type: "string" } },
            { name: "source_system", in: "query", schema: { type: "string" } },
            { name: "outcome", in: "query", schema: { type: "string", enum: ["success", "failure"] } },
            { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 100, maximum: 500 } },
          ],
          responses: {
            "200": { description: "Paginated audit entries", content: { "application/json": { schema: paginatedEnvelope(AuditEntry) } } },
            ...errorResponses,
          },
        },
      },
    },
    "x-fgc-standard": {
      version: "v1",
      reason_codes: FGC_REASON_CODES,
      webhook_events: [
        "customer.created",
        "customer.updated",
        "customer.suspended",
        "customer.reactivated",
        "customer.archived",
        "contact.created",
        "contact.updated",
        "contact.deleted",
        "user.created",
        "user.updated",
        "user.suspended",
        "user.reactivated",
        "subscription.created",
        "subscription.cancelled",
        "billing_profile.created",
        "billing_profile.updated",
        "billing_profile.credit_hold_applied",
        "billing_profile.credit_hold_released",
        "provisioning.requested",
        "ticket.created",
        "ticket.updated",
        "ticket.escalated",
      ],
    },
  });
});

export default router;
