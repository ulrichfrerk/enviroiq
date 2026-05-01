import "express-session";

declare module "express-session" {
  interface SessionData {
    userId: string;
    email: string;
    name: string;
    role: "super_admin" | "org_admin" | "org_viewer";
    organisationId: string | null;
    webAuthnChallengeId?: string;
    /** Set after email ownership is verified via magic-link; permits passkey enrollment for this email */
    verifiedEmail?: string;
    /** In-flight OIDC SSO authorization request — cleared on callback. */
    oidcFlow?: {
      provider: "google" | "microsoft";
      state: string;
      nonce: string;
      codeVerifier: string;
      redirectUri: string;
      returnTo?: string;
      createdAt: number;
    };
  }
}
