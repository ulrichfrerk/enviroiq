# EnviroIQ — CRM Integration API

**Version:** 1.0.0
**Base URL:** `https://enviroiq.net/api/v1`
**Auth:** Bearer API key (`Authorization: Bearer eiq_live_...`)
**Format:** JSON over HTTPS

---

## 1. Purpose

This API lets a sister CRM application (also hosted on Replit) act as the
**system of record for customer relationships** while EnviroIQ acts as the
**system of record for ESG operations**. The CRM can:

1. **Provision** new customers (creates an EnviroIQ organisation + admin user with magic-link sign-in)
2. **Manage users** (invite, change role, deactivate)
3. **Lock or unlock accounts** (e.g. on payment failure)
4. **Update billing plan / status** (operate / assure / enterprise)
5. **Sync live ESG data** back to the CRM (sustainability score, CO₂e totals)
6. **Sync supplier audit progress** back to the CRM (% compliant, audits due, average score) so the CRM can drive reminders, account-health scoring and renewal conversations.

---

## 2. Authentication

Every request requires:

```
Authorization: Bearer eiq_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are issued from the EnviroIQ **Super Admin → CRM API & Keys** page.
EnviroIQ stores only a one-way SHA-256 hash; the plaintext value is shown
exactly once at creation. If lost, revoke and reissue.

### Scopes

A key carries an explicit set of scopes. Calls outside its scopes return `403`.

| Scope                | What it lets you do                                            |
|----------------------|----------------------------------------------------------------|
| `customers:read`     | List / read customer records                                   |
| `customers:write`    | Create customers, update profile, lock/unlock accounts         |
| `users:read`         | List users for any customer                                    |
| `users:write`        | Invite users, change roles, deactivate users                   |
| `metrics:read`       | Read ESG snapshot (score, CO₂e, energy)                        |
| `audits:read`        | Read supplier audit summary + recent audits                    |
| `billing:read`       | Read plan + billing status                                     |
| `billing:write`      | Change plan, mark `past_due`, suspend                          |

> **Recommendation:** Issue **two keys** — one read-only (sync) key with
> `customers:read users:read metrics:read audits:read billing:read`,
> and one write key for provisioning with the `*:write` scopes. Store both
> in your CRM secrets vault.

---

## 3. Endpoints

### 3.1 Sanity check
```
GET /v1/ping
```
Returns `{ ok: true, keyName, keyPrefix, scopes, serverTime }`.

### 3.2 Customers

#### List
```
GET /v1/customers?page=1&limit=50
```
Scope: `customers:read`. Response: `{ items: Customer[], total, page, limit }`.

#### Create
```
POST /v1/customers
{
  "name":         "Acme Logistics",
  "industry":     "Transport",
  "country":      "NZ",
  "adminEmail":   "ceo@acme.co.nz",
  "adminName":    "Jane Smith",
  "plan":         "assure",
  "sendInvite":   true
}
```
Scope: `customers:write`. Response includes the new customer, the admin user,
and a 24-hour `magicLink.url`. If `sendInvite` is omitted or `true` the link
is also emailed automatically.

#### Read one
```
GET /v1/customers/{id}
```

#### Update / lock / unlock
```
PATCH /v1/customers/{id}
{ "name": "...", "industry": "...", "isActive": false }

POST /v1/customers/{id}/lock      # convenience — sets isActive=false
POST /v1/customers/{id}/unlock    # convenience — sets isActive=true
```
Scope: `customers:write`.

### 3.3 Users

```
GET    /v1/customers/{id}/users
POST   /v1/customers/{id}/users           { email, name, role?, sendInvite? }
PATCH  /v1/customers/{id}/users/{userId}  { role?, isActive? }
DELETE /v1/customers/{id}/users/{userId}  # soft-deactivate
```
Roles: `org_admin`, `org_user`, `org_viewer`, `org_auditor` (defaults to `org_user`).
`POST` returns a 24-hour magic-link URL the CRM may also send.

### 3.4 Metrics (sync to CRM)

```
GET /v1/customers/{id}/metrics
```
Scope: `metrics:read`. Returns:

```json
{
  "organisationId": "…",
  "sustainabilityScore": 72.4,
  "totalCo2eKg": 84720.1,
  "fleetCo2eKg": 47210.3,
  "energyCo2eKg": 37509.8,
  "energyKwh": 932140.0,
  "computedAt": "2026-04-17T06:24:00Z"
}
```
Recommended cadence: nightly poll, or on-demand when the account is opened in the CRM.

### 3.5 Supplier audits (drives CRM reminders)

```
GET /v1/customers/{id}/audits
```
Scope: `audits:read`. Returns:

```json
{
  "totalSuppliers":          124,
  "totalAudits":             318,
  "auditsByStatus":          { "draft":4, "sent":12, "submitted":280, "approved":18, "expired":4 },
  "compliancePct":           93.7,
  "averageEsgScore":         71.2,
  "auditsDueWithin30Days":   9,
  "recent": [
    { "id":"…","supplierId":"…","status":"submitted","esgScore":78,"riskLevel":"low",
      "sentAt":"…","dueAt":"…","submittedAt":"…" }
  ]
}
```
Use `auditsDueWithin30Days` and `compliancePct` to power CRM dashboards,
account-health scores and reminder workflows.

### 3.6 Billing

```
GET   /v1/customers/{id}/billing
PATCH /v1/customers/{id}/billing  { plan?, billingStatus? }
```
- `plan` ∈ `operate | assure | enterprise`
- `billingStatus` ∈ `active | trialing | past_due | suspended`
- Setting `billingStatus = suspended` also locks the account (`isActive=false`).

---

## 4. Recommended CRM ↔ EnviroIQ sync pattern

| Trigger in CRM                  | Call to EnviroIQ                                |
|---------------------------------|-------------------------------------------------|
| New deal closes (won)           | `POST /v1/customers`                            |
| Add seat                        | `POST /v1/customers/{id}/users`                 |
| Remove seat                     | `DELETE /v1/customers/{id}/users/{userId}`      |
| Plan change                     | `PATCH /v1/customers/{id}/billing`              |
| Payment failure                 | `PATCH /v1/customers/{id}/billing` → `past_due` |
| Cancellation                    | `POST /v1/customers/{id}/lock` (or `suspended`) |
| Reactivation                    | `POST /v1/customers/{id}/unlock`                |
| Nightly metrics sync (cron)     | `GET  /v1/customers/{id}/metrics`               |
| Nightly audit sync (cron)       | `GET  /v1/customers/{id}/audits`                |
| Account opened in CRM (on-demand)| `GET  /v1/customers/{id}` + metrics + audits   |

---

## 5. Error model

All errors return JSON with this shape:

```json
{ "error": "Forbidden", "message": "API key is missing required scope(s): customers:write",
  "requiredScopes": ["customers:write"], "keyScopes": ["customers:read"] }
```

| Status | Meaning                                   |
|--------|-------------------------------------------|
| 400    | Bad request (validation failure)          |
| 401    | Missing / invalid / revoked / expired key |
| 403    | Key lacks the required scope              |
| 404    | Resource not found                        |
| 429    | Rate-limit exceeded                       |
| 500    | Server error                              |

Rate limit: **500 requests / 15 min / source IP** by default — contact the platform team for higher limits.

---

## 6. Security model

- Keys are stored as **SHA-256 hashes** only — never in plaintext, never in logs.
- All key matching uses **constant-time comparison** to prevent timing attacks.
- Every authenticated call is logged with method, path, status, IP, timestamp and key prefix in `crm_api_key_usage` and the global `audit_logs` table.
- Revocation is immediate — no caching window.
- Transport is HTTPS-only; HSTS preloaded.
- Keys may carry an optional `expiresAt` for short-lived integrations.
- Keys are issued by the platform operator only (Super Admin). They are **global** (act across all customers) by design — a CRM is a cross-tenant operator.

If a key leaks: revoke in the EnviroIQ portal → re-issue → review the audit log filter for `crm.*` actions from the leaked prefix.

---

## 7. OpenAPI spec

Machine-readable OpenAPI 3.1 JSON: **`GET /api/v1/openapi.json`**
(Drop straight into Postman, Insomnia, Swagger UI, or `openapi-generator` for typed clients.)
