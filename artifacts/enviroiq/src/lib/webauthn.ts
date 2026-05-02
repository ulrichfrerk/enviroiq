/**
 * WebAuthn passkey helpers — wraps @simplewebauthn/browser and talks to
 * /api/auth/passkey/* on our api-server. Uses session cookies (credentials: include).
 */
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

const API = "/api/auth/passkey";

/**
 * Thrown when the api-server refuses a passkey sign-in because org or
 * per-user policy disallows the method. Carries the structured `code` and
 * `source` returned by the server so the sign-in page can render the same
 * friendly amber "this method isn't available" callout that the SSO callback
 * flow uses (see task #19).
 *   - `code`   — `passkey_method_not_allowed` | `passkey_required_provider_mismatch`
 *                | `passkey_provider_disabled` (mirrors the SSO `sso_*` codes).
 *   - `source` — `"user"` for a per-user override, `"org"` for an org-wide
 *                policy. The sign-in page picks the wording from this.
 */
export class PasskeyRestrictionError extends Error {
  readonly code: string;
  readonly source: "user" | "org" | null;
  constructor(message: string, code: string, source: "user" | "org" | null) {
    super(message);
    this.name = "PasskeyRestrictionError";
    this.code = code;
    this.source = source;
  }
}

async function jsonFetch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
      source?: "user" | "org";
    };
    // A 403 with a `passkey_*` code is a policy refusal, not a transport
    // error — surface it as a typed exception so the sign-in page can swap
    // the small inline error for the prominent amber restriction callout.
    if (
      res.status === 403 &&
      typeof data.code === "string" &&
      data.code.startsWith("passkey_")
    ) {
      throw new PasskeyRestrictionError(
        data.error || "Sign-in method not available",
        data.code,
        data.source === "user" || data.source === "org" ? data.source : null,
      );
    }
    throw new Error(data.error || `Request failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    typeof navigator.credentials !== "undefined"
  );
}

/** Begin + complete passkey enrolment for the current session user. */
export async function enrollPasskey(): Promise<void> {
  const options = await jsonFetch<PublicKeyCredentialCreationOptionsJSON>(
    `${API}/register/options`,
  );
  const credential = await startRegistration({ optionsJSON: options });
  await jsonFetch(`${API}/register/verify`, credential);
}

/** Sign in via passkey. If `email` provided we narrow allowCredentials. */
export async function signInWithPasskey(email?: string): Promise<void> {
  const options = await jsonFetch<PublicKeyCredentialRequestOptionsJSON>(
    `${API}/login/options`,
    email ? { email } : undefined,
  );
  const credential = await startAuthentication({ optionsJSON: options });
  await jsonFetch(`${API}/login/verify`, credential);
}
