# EnviroIQ API Server

Express 5 API for the EnviroIQ platform. Handles auth, organisations, users,
fleet & energy data, ESG metrics, the public widget, supplier portal and more.

## Sign-in methods

EnviroIQ supports four sign-in methods, controlled per-organisation in
**Settings → Sign-in & SSO**:

| Method          | Notes                                                              |
| --------------- | ------------------------------------------------------------------ |
| `magic_link`    | Email link, 15 min TTL. Always available to `org_admin` (break-glass). |
| `passkey`       | WebAuthn / FIDO2.                                                  |
| `google_sso`    | OIDC + PKCE against Google (`accounts.google.com`).                |
| `microsoft_sso` | OIDC + PKCE against Microsoft (`login.microsoftonline.com/common`). |

Org admins can:

- Toggle Google / Microsoft on or off for the whole org.
- Restrict the list of allowed sign-in methods.
- Optionally pin **one required SSO provider** for non-admin users.

Sign-in via SSO **never creates accounts**. The user must already exist (invited
by an admin) and have the same `email` as the verified provider claim. SSO
identities are linked on first successful sign-in and stored in the
`sso_identities` table.

### Strict email verification policy

The server only accepts an SSO sign-in when the provider has *explicitly*
verified the user's email:

- **Google**: requires `email_verified === true` in the ID token (Google sets
  this for both Gmail and Workspace accounts).
- **Microsoft**: requires `email_verified === true` *or*, when that claim is
  absent, `xms_edov === true` (the Microsoft "Email Domain Owner Verified"
  optional claim). For an Entra ID tenant, **enable optional claims for the
  `email` and `xms_edov` claims** on the App Registration → Token
  configuration → Add optional claim → ID token. Without that, Microsoft
  Entra users will see `?error=sso_email_unverified` and need to fall back to
  magic-link or passkey.

All SSO and policy events are written to the audit log:

- `sso.sign_in.success`
- `sso.sign_in.rejected` (with reason: `unknown_email`, `account_inactive`,
  `email_unverified`, `provider_disabled`, `method_not_allowed`,
  `required_provider_mismatch`, …)
- `sso.identity.linked`
- `sso.policy.changed`
- `auth.break_glass_magic_link` (org_admin requested a magic link while
  magic-link was disabled by policy)

## Configuring Google & Microsoft OIDC

The server reads the following secrets / env vars:

```
GOOGLE_OIDC_CLIENT_ID
GOOGLE_OIDC_CLIENT_SECRET
MICROSOFT_OIDC_CLIENT_ID
MICROSOFT_OIDC_CLIENT_SECRET
OIDC_REDIRECT_BASE_URL    # e.g. https://app.enviroiq.com (no trailing slash)
```

The redirect URIs you must register with each provider are:

```
${OIDC_REDIRECT_BASE_URL}/api/auth/sso/google/callback
${OIDC_REDIRECT_BASE_URL}/api/auth/sso/microsoft/callback
```

### Google Cloud — OAuth 2.0 Client (Web application)

1. Open <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials → OAuth client ID → Web application**.
3. **Authorised redirect URIs**: add the Google callback URL above.
4. Copy the **Client ID** and **Client secret** into Replit secrets as
   `GOOGLE_OIDC_CLIENT_ID` and `GOOGLE_OIDC_CLIENT_SECRET`.
5. On the OAuth consent screen, ensure the `openid`, `email` and `profile`
   scopes are enabled.

### Microsoft Entra ID — App registration

1. Open <https://entra.microsoft.com/> → **App registrations → New registration**.
2. **Supported account types**: choose what your customers need
   (e.g. *Accounts in any organizational directory and personal Microsoft accounts*
   to match the `/common` issuer the server accepts).
3. **Redirect URI**: type **Web**, value = the Microsoft callback URL above.
4. After creation, copy **Application (client) ID** into
   `MICROSOFT_OIDC_CLIENT_ID`.
5. **Certificates & secrets → New client secret**, copy the *Value* into
   `MICROSOFT_OIDC_CLIENT_SECRET`.
6. **API permissions → Microsoft Graph → Delegated → openid, email, profile,
   offline_access** (the basic OIDC scopes; admin consent is not required).

## Database schema

This monorepo uses **`drizzle-kit push`** (not generated migration files) as
its deploy/rollout path — see `lib/db/package.json` (`pnpm --filter
@workspace/db push`). The schema-of-record lives in `lib/db/src/schema/`. The
SSO rollout adds:

- `sso_identities` (provider, sub, user_id, email, linked_at, last_used_at,
  raw_claims jsonb).
- `organisations.google_sso_enabled` (bool, default true)
- `organisations.microsoft_sso_enabled` (bool, default true)
- `organisations.allowed_sign_in_methods` (jsonb array of method strings,
  default `["magic_link","passkey","google_sso","microsoft_sso"]`)
- `organisations.required_sso_provider` (text nullable: `google` | `microsoft`)

Apply on a fresh DB with `pnpm --filter @workspace/db push`.

## Endpoints

| Method | Path                                          | Notes                       |
| ------ | --------------------------------------------- | --------------------------- |
| GET    | `/api/auth/sso/providers`                     | Public; returns providers that have credentials configured server-side. Currently informational only. |
| GET    | `/api/auth/sso/:provider/start`               | Begins OIDC flow (302).     |
| GET    | `/api/auth/sso/:provider/callback`            | Provider redirect target.   |
| GET    | `/api/organisations/:orgId/sso-policy`        | Admin-only, returns policy. |
| PATCH  | `/api/organisations/:orgId/sso-policy`        | Admin-only, audited. Refuses changes that would lock out non-admin users (e.g. only `google_sso` allowed but Google disabled). |

The sign-in page intentionally **always shows both Google and Microsoft
buttons** — we don't ask the user for an email before showing them, so we can't
tailor the UI per organisation. Per-org enforcement happens in the callback,
which redirects with a friendly `?error=sso_*` code if the provider is
disabled, the method is not allowed, or a different provider is required.

The flow is **Authorization Code + PKCE** with `nonce` and `state` stored in the
session and discarded after a single round-trip. ID tokens are verified against
the provider's JWKS (cached for 1 h) using `jose`.
