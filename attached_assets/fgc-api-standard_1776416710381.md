# Frerken Good Companies — Customer Operations API Standard

**Version:** 1  

**Generated:** 2026-04-17T09:05:00.688Z  

The CRM is the system of record for customer identity, commercial ownership, and operational intent. Every connected FGC app must speak this language for customer lifecycle, billing, access, support, and provisioning.

---

## Core Principle

The CRM drives customer creation, updates, service assignment, billing changes, user access, provisioning, suspension, reactivation, audit trail, and support linkage. Every connected app consumes the same core objects and responds to the same event types.

## Governance Rule

> No application may create, update, suspend, bill, provision, or disable a customer-related entity without: a shared identifier · a standard status · a source system · an audit record · a reason code where material · an authorised actor

## Core Entities

- Customer
- Organisation / Account
- Contact
- User
- Subscription / Plan
- Product / Service
- Site / Location
- Billing Profile
- Invoice / Payment Status
- Service Status
- Credential / Authentication State
- Provisioning Request
- Support / Service Desk Record
- Audit Log
- Role / Permission Set
- API Credential / Integration Key

## Entity Field Standards

### Organisation / Account

**Required fields:**

- `customer_id`
- `legal_entity_name`
- `trading_name`
- `company_number`
- `gst_vat_tax_number`
- `account_type`
- `industry`
- `account_owner`
- `account_manager`
- `commercial_status`
- `onboarding_status`
- `risk_rating`
- `support_tier`
- `contract_start_date`
- `contract_end_date`
- `renewal_date`
- `parent_account_id`
- `child_account_ids`
- `notes`
- `tags`

**Account type values:** prospect, active_customer, suspended, closed

**Recommended extras:**

- `credit_limit`
- `payment_terms`
- `preferred_currency`
- `default_timezone`
- `default_language`
- `privacy_classification`
- `security_classification`
- `dpa_nda_status`
- `trust_framework_status`
- `compliance_status`

### Contact

**Required fields:**

- `contact_id`
- `first_name`
- `last_name`
- `job_title`
- `email`
- `mobile`
- `phone`
- `department`
- `role_in_customer_business`
- `primary_contact_flag`
- `active_flag`

**Contact role values:** billing, technical, procurement, executive, support

**Recommended extras:**

- `preferred_communication_method`
- `marketing_consent`
- `escalation_level`
- `after_hours_contact_flag`
- `notes`

### User

**Required fields:**

- `user_id`
- `linked_account_id`
- `linked_contact_id`
- `username`
- `email`
- `status`
- `mfa_enabled`
- `last_login`
- `password_reset_required_flag`
- `identity_provider`
- `role_ids`
- `app_access_list`

**Status values:** invited, active, locked, suspended, disabled

**Identity providers:** local, google, microsoft, sso

**Recommended extras:**

- `failed_login_count`
- `lockout_timestamp`
- `password_last_changed`
- `terms_accepted_date`
- `privacy_accepted_date`
- `ip_device_history_summary`

## Shared Field Standards

**Status values:** active, pending, suspended, disabled, archived, cancelled, locked, provisioning, error

**Reason codes:** customer_request, billing_non_payment, security_event, compliance_issue, duplicate_record, internal_admin_change, failed_verification, contract_end, fraud_review

**Mandatory shared identifiers:** `customer_id`, `organisation_id`, `contact_id`, `user_id`, `subscription_id`, `billing_profile_id`, `service_instance_id`, `ticket_id`, `audit_id`

**Mandatory metadata:** `created_at`, `updated_at`, `created_by`, `updated_by`, `source_system`, `correlation_id`, `version`, `status`

**Mandatory lifecycle controls:** active, suspend, reactivate, archive, delete (only where safe and lawful)

## Lifecycle Actions

### Customer

- create customer
- update customer
- archive customer
- deactivate customer
- restore customer
- merge duplicate customers
- transfer ownership
- change account manager

### Contact

- add contact
- update contact
- remove contact
- mark contact inactive
- set primary contact
- assign billing contact
- assign support contact

### User

- create user
- invite user
- activate user
- deactivate user
- suspend user
- unlock user
- reset password
- force password change
- revoke sessions
- enable mfa
- disable mfa
- change roles
- change app access

### Subscription

- assign product
- assign subscription plan
- upgrade plan
- downgrade plan
- renew service
- cancel service
- suspend service
- reactivate service
- adjust entitlements
- add addon
- remove addon

### Billing

- create billing profile
- update billing details
- change invoice recipient
- change payment method token
- update purchase order number
- apply discount
- apply credit
- suspend for non payment
- restore after payment
- issue refund flag
- tax exempt update

### Provisioning

- request provisioning
- approve provisioning
- provision tenant environment
- assign licence
- assign api key
- generate service instance
- link customer to app
- allocate site device resource
- deprovision service
- reprovision service

### Security

- rotate api keys
- disable api keys
- force session logout
- mark account as high risk
- block access
- unblock access
- record security exception
- initiate breach workflow flag

## Payload Groups

### Identity

_Who is this customer and who belongs to them?_

Fields: `customer_id`, `organisation_name`, `contact_ids`, `user_ids`, `email_domains`, `identity_provider`, `tenant_id`

### Commercial

_What are they entitled to commercially?_

Fields: `subscription_id`, `plan_code`, `contract_status`, `billing_status`, `pricing_tier`, `support_tier`, `renewal_date`, `credit_hold_flag`

### Access

_What can they do?_

Fields: `user_id`, `role_codes`, `permission_codes`, `app_access`, `site_access`, `device_access`, `feature_flags`

### Service

_What services do they have?_

Fields: `product_code`, `service_instance_id`, `environment`, `status`, `start_date`, `end_date`, `assigned_resources`, `linked_sites`, `linked_devices`

### Billing

_How do they pay and who gets invoiced?_

Fields: `billing_profile_id`, `billing_contact_id`, `invoice_email`, `currency`, `payment_terms`, `tax_number`, `payment_method_token`, `po_number`, `billing_address`

### Operational State

_What is the operational state right now?_

Fields: `account_status`, `service_status`, `suspension_reason`, `lock_reason`, `onboarding_stage`, `compliance_status`, `provisioning_status`

### Audit

_Who changed what and why?_

Fields: `action_id`, `actor_id`, `actor_type`, `source_system`, `correlation_id`, `timestamp`, `previous_value`, `new_value`, `reason_code`, `notes`

## Billing Standard

Fields: `billing_legal_entity_name`, `billing_contact`, `billing_email`, `accounts_payable_email`, `purchase_order_number`, `tax_number`, `billing_address`, `shipping_address`, `currency`, `payment_terms`, `payment_method_token`, `direct_debit_status`, `invoice_delivery_method`, `invoice_grouping_rules`, `statement_cycle`, `suspension_threshold`, `collections_status`

> **Warning:** Never store raw card numbers. Store only a payment gateway token/reference.

## Credential Change Standard

**Action types:** user_self_service_password_reset, admin_initiated_password_reset, force_password_change_next_login, credential_disable, session_revocation, mfa_reset

**Required audit fields:** who_initiated, why_it_happened, when_it_happened, sessions_revoked, user_notified, mfa_reset_too

## Suspension Standard

**Targets:** account, subscription, user, service_instance

**Required fields:**

- `suspension_target`
- `suspension_reason`
- `effective_date_time`
- `automatic_or_manual`
- `initiated_by`
- `expected_reactivation_date`
- `customer_notified_flag`
- `internal_notes`
- `downstream_systems_impacted`
- `billing_continues`
- `data_remains_accessible`
- `login_blocked`
- `api_access_blocked`

## Event Model

- `customer.created`
- `customer.updated`
- `customer.archived`
- `contact.created`
- `contact.updated`
- `user.invited`
- `user.activated`
- `user.suspended`
- `user.password_reset_requested`
- `user.password_reset_completed`
- `billing.updated`
- `invoice.overdue`
- `subscription.created`
- `subscription.changed`
- `subscription.cancelled`
- `service.provisioning_requested`
- `service.provisioned`
- `service.suspended`
- `service.reactivated`
- `access.role_changed`
- `api_key.rotated`
- `security.alert_raised`
- `support.ticket_created`
- `support.ticket_escalated`

## Security Requirements

### Authentication

- OAuth2 or signed service-to-service auth
- MFA for admin actions
- Short-lived tokens where possible
- API key rotation support

### Authorisation

- RBAC minimum
- ABAC recommended for advanced environments
- Per-app permission scopes
- Least privilege access

### Auditability

- Every change logged
- Immutable audit records preferred
- Old and new values captured
- Actor identity captured
- Source system captured
- Correlation ID across workflows

### Data Protection

- Encryption in transit
- Encryption at rest
- PII classification
- Secrets stored in secret manager, not plain DB fields
- Passwords never retrievable — only resettable
- Card data tokenised only

### Operational Controls

- Rate limiting
- Retry logic
- Idempotency keys for create/update actions
- Soft delete where appropriate
- Versioning
- Webhook signing
- Alerting on failed provisioning or failed sync

## Minimum Endpoint List

### Customers

- `POST /customers`
- `GET /customers/{id}`
- `PATCH /customers/{id}`
- `POST /customers/{id}/suspend`
- `POST /customers/{id}/reactivate`
- `POST /customers/{id}/archive`

### Contacts

- `POST /customers/{id}/contacts`
- `PATCH /contacts/{id}`
- `DELETE /contacts/{id}`

### Users

- `POST /customers/{id}/users`
- `PATCH /users/{id}`
- `POST /users/{id}/invite`
- `POST /users/{id}/suspend`
- `POST /users/{id}/unlock`
- `POST /users/{id}/reset-password`
- `POST /users/{id}/revoke-sessions`
- `POST /users/{id}/mfa-reset`

### Billing

- `GET /customers/{id}/billing-profile`
- `PATCH /customers/{id}/billing-profile`
- `POST /customers/{id}/payment-method`
- `POST /customers/{id}/credit-hold`
- `POST /customers/{id}/release-credit-hold`

### Subscriptions

- `POST /customers/{id}/subscriptions`
- `PATCH /subscriptions/{id}`
- `POST /subscriptions/{id}/upgrade`
- `POST /subscriptions/{id}/downgrade`
- `POST /subscriptions/{id}/cancel`
- `POST /subscriptions/{id}/suspend`
- `POST /subscriptions/{id}/reactivate`

### Provisioning

- `POST /provisioning/requests`
- `GET /provisioning/requests/{id}`
- `POST /service-instances/{id}/suspend`
- `POST /service-instances/{id}/reactivate`
- `DELETE /service-instances/{id}`

### Support

- `POST /tickets`
- `GET /tickets/{id}`
- `PATCH /tickets/{id}`
- `POST /tickets/{id}/assign`
- `POST /tickets/{id}/escalate`
- `POST /tickets/{id}/close`

### Audit

- `GET /audit?customer_id=`
- `GET /audit?user_id=`
- `GET /audit/{id}`

## System of Record Split

### CRM

- account master
- contacts
- commercial ownership
- sales status
- billing intent
- relationship history

### Identity Platform

- login credentials
- MFA
- session control
- identity federation

### Billing Platform

- invoice generation
- payment collection
- tax handling
- payment tokens

### Product / Service Platform

- provisioning
- service state
- tenant resources
- technical entitlements

### Service Desk

- incidents
- requests
- changes
- internal tasks
- resolution history

_The CRM orchestrates and references these platforms — it does not need to replicate them natively._

## Technical Conventions

### Authentication

- Scheme: Bearer

- Format: `Authorization: Bearer {api_key}`

- Key pattern: `{app}_{environment}_{random64hex}`

### Versioning

- Current version: v1

- Format: `/api/v1/{resource}`

- Deprecation: Deprecated versions receive a Deprecation header 6 months before removal

### Response Envelope

```json
{
  "description": "Every response is wrapped in a consistent envelope. Never return bare arrays or bare objects.",
  "success": {
    "success": true,
    "data": "<object | array>",
    "meta": {
      "timestamp": "<ISO 8601>",
      "version": "<api version string>",
      "requestId": "<uuid>"
    }
  },
  "paginated": {
    "success": true,
    "data": "<array>",
    "pagination": {
      "page": "<integer, 1-indexed>",
      "limit": "<integer>",
      "total": "<integer>",
      "totalPages": "<integer>",
      "hasMore": "<boolean>"
    },
    "meta": {
      "timestamp": "<ISO 8601>",
      "version": "<string>",
      "requestId": "<uuid>"
    }
  },
  "error": {
    "success": false,
    "error": {
      "code": "<SCREAMING_SNAKE_CASE>",
      "message": "<human-readable>",
      "details": "<optional>"
    },
    "meta": {
      "timestamp": "<ISO 8601>",
      "version": "<string>",
      "requestId": "<uuid>"
    }
  }
}
```

### HTTP Status Codes

- **200** — OK — successful GET, PATCH, POST (non-creating)
- **201** — Created — successful POST that created a resource
- **204** — No Content — successful DELETE
- **400** — Bad Request — malformed body or query params
- **401** — Unauthorized — missing or invalid API key
- **403** — Forbidden — valid key but insufficient scope
- **404** — Not Found — resource does not exist
- **409** — Conflict — duplicate slug/email/unique field
- **422** — Unprocessable — body parses but fails business validation
- **429** — Too Many Requests — rate limit exceeded
- **500** — Internal Server Error
- **502** — Bad Gateway — upstream service unreachable

### Error Codes

- `BAD_REQUEST` — Malformed request body or query params
- `UNAUTHORIZED` — Missing or invalid API key
- `FORBIDDEN` — Valid key but insufficient scope or permissions
- `NOT_FOUND` — Requested resource does not exist
- `CONFLICT` — Unique constraint violation
- `UNPROCESSABLE` — Body is valid JSON but fails business rule validation
- `RATE_LIMITED` — Request rate limit exceeded
- `INTERNAL_ERROR` — Unexpected server error
- `UPSTREAM_ERROR` — Third-party API is unreachable or returned an error

### Rate Limiting

- api: 300 req / 15 min
- auth: 20 req / 1 min
- management: 120 req / 1 min

### Field Conventions

- **timestamps:** [object Object]
- **booleans:** Prefixed with is or has: isLocked, isActive, hasMore
- **nulls:** Use null (not undefined or empty string) for absent optional fields
- **money:** Store as string/decimal in DB; expose as number in JSON
- **enums:** SCREAMING_SNAKE_CASE: IN_PROGRESS, RATE_LIMITED

### Example Route

```typescript
import { ok, created, paginated, Errors } from "../lib/api-response";

router.get("/", async (req, res) => {
  const page  = Number(req.query.page)  || 1;
  const limit = Number(req.query.limit) || 20;
  const items = await db.select()...;
  res.json(paginated(items, { page, limit, total: items.length }, req));
});

router.get("/:id", async (req, res) => {
  const [item] = await db.select().where(eq(table.id, +req.params.id));
  if (!item) throw Errors.notFound("Customer");
  res.json(ok(item, req));
});

router.post("/", async (req, res) => {
  const [item] = await db.insert(table).values(req.body).returning();
  res.status(201).json(created(item, req));
});

router.delete("/:id", async (req, res) => {
  await db.delete(table).where(eq(table.id, +req.params.id));
  noContent(res);
});
```
