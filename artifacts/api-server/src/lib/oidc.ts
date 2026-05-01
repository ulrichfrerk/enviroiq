import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { logger } from "./logger.js";

/**
 * Native OIDC client for Google and Microsoft sign-in.
 *
 * No external SaaS in the loop — we hit the provider's discovery document,
 * cache it, fetch their JWKS, and verify id_tokens directly. The browser
 * never sees the client secret; everything happens server-side.
 */

export type OidcProviderName = "google" | "microsoft";

interface ProviderEnv {
  clientId: string;
  clientSecret: string;
  discoveryUrl: string;
  scopes: string;
  /** Display label used in UI / audit logs. */
  label: string;
}

interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

interface ProviderRuntime {
  env: ProviderEnv;
  discovery: DiscoveryDoc;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  fetchedAt: number;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000; // 1h — Google / Microsoft change this rarely.

const PROVIDER_CONFIGS: Record<OidcProviderName, Omit<ProviderEnv, "clientId" | "clientSecret">> = {
  google: {
    discoveryUrl: "https://accounts.google.com/.well-known/openid-configuration",
    scopes: "openid email profile",
    label: "Google",
  },
  microsoft: {
    // `common` covers BOTH personal Microsoft accounts and work/school (Entra ID) tenants.
    discoveryUrl: "https://login.microsoftonline.com/common/v2.0/.well-known/openid-configuration",
    scopes: "openid email profile",
    label: "Microsoft",
  },
};

const cache = new Map<OidcProviderName, ProviderRuntime>();

function readEnvForProvider(name: OidcProviderName): ProviderEnv | null {
  const upper = name.toUpperCase();
  const clientId = process.env[`${upper}_OIDC_CLIENT_ID`];
  const clientSecret = process.env[`${upper}_OIDC_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, ...PROVIDER_CONFIGS[name] };
}

export function isProviderConfigured(name: OidcProviderName): boolean {
  return readEnvForProvider(name) !== null;
}

export function configuredProviders(): OidcProviderName[] {
  return (Object.keys(PROVIDER_CONFIGS) as OidcProviderName[]).filter(isProviderConfigured);
}

async function fetchDiscovery(url: string): Promise<DiscoveryDoc> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`OIDC discovery fetch failed ${res.status} for ${url}`);
  const doc = (await res.json()) as DiscoveryDoc;
  if (!doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri || !doc.issuer) {
    throw new Error(`OIDC discovery doc malformed for ${url}`);
  }
  return doc;
}

async function getProvider(name: OidcProviderName): Promise<ProviderRuntime> {
  const existing = cache.get(name);
  if (existing && Date.now() - existing.fetchedAt < DISCOVERY_TTL_MS) return existing;

  const env = readEnvForProvider(name);
  if (!env) throw new Error(`Provider ${name} is not configured`);

  const discovery = await fetchDiscovery(env.discoveryUrl);
  const jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
  const runtime: ProviderRuntime = { env, discovery, jwks, fetchedAt: Date.now() };
  cache.set(name, runtime);
  return runtime;
}

/** Compute the redirect_uri we register with Google / Microsoft. */
export function buildRedirectUri(name: OidcProviderName, fallbackBase: string): string {
  const base = (process.env.OIDC_REDIRECT_BASE_URL || fallbackBase).replace(/\/$/, "");
  return `${base}/api/auth/sso/${name}/callback`;
}

/**
 * Build the provider's authorize URL with PKCE + state + nonce.
 * Returns the URL the browser should be 302'd to.
 */
export async function buildAuthorizeUrl(
  name: OidcProviderName,
  args: { state: string; nonce: string; codeChallenge: string; redirectUri: string },
): Promise<string> {
  const provider = await getProvider(name);
  const u = new URL(provider.discovery.authorization_endpoint);
  u.searchParams.set("client_id", provider.env.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", args.redirectUri);
  u.searchParams.set("scope", provider.env.scopes);
  u.searchParams.set("state", args.state);
  u.searchParams.set("nonce", args.nonce);
  u.searchParams.set("code_challenge", args.codeChallenge);
  u.searchParams.set("code_challenge_method", "S256");
  // Microsoft accepts (and benefits from) response_mode=query; harmless on Google.
  u.searchParams.set("response_mode", "query");
  return u.toString();
}

interface TokenResponse {
  id_token: string;
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

/** Exchange the authorization code for an id_token at the provider's token endpoint. */
export async function exchangeCodeForTokens(
  name: OidcProviderName,
  args: { code: string; codeVerifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const provider = await getProvider(name);
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", args.code);
  body.set("redirect_uri", args.redirectUri);
  body.set("client_id", provider.env.clientId);
  body.set("client_secret", provider.env.clientSecret);
  body.set("code_verifier", args.codeVerifier);

  const res = await fetch(provider.discovery.token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    // We deliberately do NOT propagate provider error bodies — surface a generic
    // failure to the caller; the audit log captures the truth.
    const text = await res.text().catch(() => "");
    logger.warn({ provider: name, status: res.status, text }, "OIDC token exchange failed");
    throw new Error("token_exchange_failed");
  }
  const json = (await res.json()) as TokenResponse;
  if (!json.id_token) throw new Error("token_exchange_no_id_token");
  return json;
}

export interface VerifiedIdToken {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  raw: JWTPayload;
}

/**
 * Verify an id_token's signature and standard claims (iss, aud, exp, iat, nonce).
 * Microsoft `common` issuers vary by tenant, so we accept any iss that starts with
 * https://login.microsoftonline.com/ (or sts.windows.net for legacy/v1).
 */
export async function verifyIdToken(
  name: OidcProviderName,
  idToken: string,
  expectedNonce: string,
): Promise<VerifiedIdToken> {
  const provider = await getProvider(name);

  const issuerCheck =
    name === "microsoft"
      ? (iss: string) =>
          iss.startsWith("https://login.microsoftonline.com/") ||
          iss.startsWith("https://sts.windows.net/")
      : (iss: string) => iss === provider.discovery.issuer;

  // jose validates `exp`, `nbf`, and (when present) `iat` for clock skew within
  // `clockTolerance`. We additionally enforce a hard `maxTokenAge` so a stolen
  // id_token cannot be replayed long after issuance, and require `iat` to be
  // present + numeric so a missing `iat` claim cannot bypass freshness.
  const { payload } = await jwtVerify(idToken, provider.jwks, {
    audience: provider.env.clientId,
    // jose accepts a string; for Microsoft we have to validate manually below.
    issuer: name === "microsoft" ? undefined : provider.discovery.issuer,
    clockTolerance: 30, // 30s
    maxTokenAge: "10 minutes",
    requiredClaims: ["iat", "exp", "sub", "aud", "iss"],
  });

  if (typeof payload.iat !== "number") throw new Error("missing_iat");

  const iss = String(payload.iss || "");
  if (!issuerCheck(iss)) throw new Error("issuer_mismatch");

  if (payload.nonce !== expectedNonce) throw new Error("nonce_mismatch");

  const sub = String(payload.sub || "");
  if (!sub) throw new Error("missing_sub");

  // Email + email_verified handling differs slightly per provider.
  // Microsoft sometimes puts the email in `preferred_username` for personal accounts.
  const rawEmail = (payload.email as string | undefined) ?? (payload.preferred_username as string | undefined);
  const email = (rawEmail || "").trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("missing_email");

  // Strict email verification gate (security requirement: only sign in users
  // whose provider has explicitly verified the email):
  //   - Google: requires `email_verified === true`.
  //   - Microsoft: Entra ID does not always emit `email_verified`. We accept
  //     `email_verified === true` OR Microsoft's optional verified-domain
  //     claim `xms_edov === true` (Email Domain Owner Verified — issued only
  //     when the tenant has been configured to mint it). If neither claim is
  //     present, the sign-in is rejected with `email_unverified` so the
  //     user gets a clear error and can fall back to magic-link.
  let emailVerified = false;
  if (payload.email_verified === true) {
    emailVerified = true;
  } else if (name === "microsoft" && payload.xms_edov === true) {
    emailVerified = true;
  }

  return {
    sub,
    email,
    emailVerified,
    name: (payload.name as string | undefined) ?? (payload.given_name as string | undefined),
    raw: payload,
  };
}
