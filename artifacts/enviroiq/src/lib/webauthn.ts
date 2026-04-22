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

async function jsonFetch<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Request failed: ${res.status}`);
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
