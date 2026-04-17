/**
 * Public OpenAPI 3.1 spec for the CRM Integration API. No auth required to
 * fetch the spec itself — it documents how to authenticate.
 */
import { Router } from "express";
import { CRM_API_SCOPES, CRM_API_SCOPE_DESCRIPTIONS } from "../lib/crm-api-keys.js";

const router = Router();

router.get("/openapi.json", (_req, res) => {
  const baseUrl = `${process.env.APP_BASE_URL?.replace(/\/app\/?$/, "") ?? "https://enviroiq.net"}/api/v1`;

  const scopes: Record<string, string> = {};
  for (const s of CRM_API_SCOPES) scopes[s] = CRM_API_SCOPE_DESCRIPTIONS[s];

  res.json({
    openapi: "3.1.0",
    info: {
      title: "EnviroIQ CRM Integration API",
      version: "1.0.0",
      description:
        "Programmatic API for sister CRM systems to provision EnviroIQ customers, manage users, lock accounts, update billing and pull live ESG + supplier-audit metrics. Authenticate every request with a Bearer API key issued from the EnviroIQ Super Admin portal.",
      contact: { name: "EnviroIQ Platform Team", email: "platform@enviroiq.net" },
    },
    servers: [{ url: baseUrl, description: "Production" }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "API key (eiq_live_…)",
        },
      },
      schemas: {
        Customer: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            slug: { type: "string" },
            industry: { type: "string", nullable: true },
            country: { type: "string", nullable: true },
            isActive: { type: "boolean" },
            plan: { type: "string", enum: ["operate", "assure", "enterprise"], nullable: true },
            billingStatus: {
              type: "string",
              enum: ["active", "trialing", "past_due", "suspended"],
              nullable: true,
            },
            sustainabilityScore: { type: "number", nullable: true },
            totalCo2eKg: { type: "number", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        CreateCustomer: {
          type: "object",
          required: ["name", "adminEmail", "adminName"],
          properties: {
            name: { type: "string" },
            industry: { type: "string" },
            country: { type: "string" },
            adminEmail: { type: "string", format: "email" },
            adminName: { type: "string" },
            plan: { type: "string", enum: ["operate", "assure", "enterprise"] },
            sendInvite: { type: "boolean", default: true },
          },
        },
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            email: { type: "string", format: "email" },
            name: { type: "string" },
            role: {
              type: "string",
              enum: ["org_admin", "org_user", "org_viewer", "org_auditor"],
            },
            isActive: { type: "boolean" },
            lastLoginAt: { type: "string", format: "date-time", nullable: true },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    "x-scopes": scopes,
    paths: {
      "/ping": {
        get: {
          summary: "Verify API key is alive",
          security: [{ bearerAuth: [] }],
          responses: { "200": { description: "OK" } },
        },
      },
      "/customers": {
        get: {
          summary: "List customers",
          description: "Requires scope `customers:read`.",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", default: 1 } },
            { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
          ],
          responses: { "200": { description: "Paginated list of customers" } },
        },
        post: {
          summary: "Create a new customer (organisation + admin user)",
          description:
            "Requires scope `customers:write`. Returns a 24-hour magic-link URL for the admin user; the email is also sent automatically unless `sendInvite=false`.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateCustomer" } } },
          },
          responses: { "201": { description: "Customer created" } },
        },
      },
      "/customers/{id}": {
        get: {
          summary: "Read a single customer",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Customer object" } },
        },
        patch: {
          summary: "Update customer profile or lock state",
          description: "Requires scope `customers:write`. Pass `isActive=false` to lock immediately.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    industry: { type: "string" },
                    country: { type: "string" },
                    isActive: { type: "boolean" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated customer" } },
        },
      },
      "/customers/{id}/lock": {
        post: {
          summary: "Lock a customer account",
          description: "Requires scope `customers:write`. Sets `isActive=false`. All user logins blocked until unlocked.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Customer locked" } },
        },
      },
      "/customers/{id}/unlock": {
        post: {
          summary: "Unlock a customer account",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Customer unlocked" } },
        },
      },
      "/customers/{id}/users": {
        get: {
          summary: "List users in a customer",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of users" } },
        },
        post: {
          summary: "Invite a user to a customer",
          description: "Requires scope `users:write`. Returns a 24-hour magic-link URL for first sign-in.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "name"],
                  properties: {
                    email: { type: "string", format: "email" },
                    name: { type: "string" },
                    role: {
                      type: "string",
                      enum: ["org_admin", "org_user", "org_viewer", "org_auditor"],
                      default: "org_user",
                    },
                    sendInvite: { type: "boolean", default: true },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "User invited" } },
        },
      },
      "/customers/{id}/users/{userId}": {
        patch: {
          summary: "Update a user's role or active state",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Updated user" } },
        },
        delete: {
          summary: "Deactivate a user (soft delete)",
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "User deactivated" } },
        },
      },
      "/customers/{id}/metrics": {
        get: {
          summary: "Get ESG metrics snapshot for sync to CRM",
          description: "Requires scope `metrics:read`. Returns the latest computed sustainability score and CO2e totals.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Metrics snapshot" } },
        },
      },
      "/customers/{id}/audits": {
        get: {
          summary: "Supplier audit summary + recent items",
          description:
            "Requires scope `audits:read`. Use this to populate CRM dashboards and trigger reminders (e.g. `auditsDueWithin30Days`).",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "Supplier audit summary",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      totalSuppliers: { type: "integer" },
                      totalAudits: { type: "integer" },
                      auditsByStatus: { type: "object", additionalProperties: { type: "integer" } },
                      compliancePct: { type: "number", nullable: true },
                      averageEsgScore: { type: "number", nullable: true },
                      auditsDueWithin30Days: { type: "integer" },
                      recent: { type: "array", items: { type: "object" } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/customers/{id}/billing": {
        get: {
          summary: "Read billing plan + status",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Billing record" } },
        },
        patch: {
          summary: "Update billing plan or status",
          description:
            "Requires scope `billing:write`. Setting `billingStatus=suspended` will also lock the account.",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    plan: { type: "string", enum: ["operate", "assure", "enterprise"] },
                    billingStatus: {
                      type: "string",
                      enum: ["active", "trialing", "past_due", "suspended"],
                    },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Updated billing record" } },
        },
      },
    },
  });
});

export default router;
