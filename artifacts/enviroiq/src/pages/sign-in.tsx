import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, KeyRound, CheckCircle2, AlertCircle, ShieldAlert, Info } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isPasskeySupported, signInWithPasskey, PasskeyRestrictionError } from "@/lib/webauthn";

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or already been used. Request a new one below.",
  already_used: "That sign-in link was already used. Please request a new one.",
  invalid_link: "That link is missing or malformed.",
  account_inactive: "Your account is inactive. Please contact your administrator.",
  server_error: "Something went wrong. Please try again.",
  // SSO error codes — server prefixes them with `sso_`
  sso_unknown_email:
    "We couldn't find an account for that email. Ask your administrator to invite you to EnviroIQ first.",
  sso_account_inactive: "Your account is inactive. Please contact your administrator.",
  sso_email_unverified: "Your provider hasn't verified your email yet. Please verify it and try again.",
  sso_provider_disabled: "That sign-in provider is disabled for your organisation.",
  sso_method_not_allowed: "That sign-in method is not enabled for your organisation.",
  sso_required_provider_mismatch: "Your organisation requires a specific sign-in provider. Try the other button.",
  sso_state: "Your sign-in attempt expired or was tampered with. Please try again.",
  sso_expired: "Your sign-in attempt expired. Please try again.",
  sso_token: "Sign-in failed during token verification. Please try again.",
  sso_denied: "Sign-in was cancelled at the provider.",
  sso_not_configured: "That sign-in provider isn't configured yet. Please contact support.",
  sso_missing_code: "Sign-in failed — missing authorization code.",
  sso_start_failed: "Could not start sign-in. Please try again.",
  sso_server_error: "Something went wrong during sign-in. Please try again.",
  sso_org_missing: "We couldn't load your organisation. Please contact support.",
  sso_policy: "Sign-in is not permitted for your account right now. Contact your administrator.",
};

/**
 * Error codes that mean "the IdP/authenticator verified you but your
 * org/account policy forbids this method". These get a more prominent,
 * helpful UI because the user genuinely needs to switch sign-in methods —
 * a small inline error banner is easy to miss.
 *
 * Both prefixes are accepted:
 *   - `sso_*`     — emitted as URL params by /auth/sso/:provider/callback
 *                   after a refused SSO callback
 *   - `passkey_*` — emitted in the JSON body by /auth/passkey/login/{options,verify}
 *                   and surfaced via PasskeyRestrictionError
 *
 * Magic-link is intentionally absent: the request endpoint is unauthenticated
 * and must not leak whether an email is restricted (see the doc comment on
 * /auth/magic-link/request in the api-server).
 */
const RESTRICTION_CODES = new Set([
  "sso_method_not_allowed",
  "sso_required_provider_mismatch",
  "sso_provider_disabled",
  "passkey_method_not_allowed",
  "passkey_required_provider_mismatch",
  "passkey_provider_disabled",
]);

/**
 * Build a clear "this method isn't available for your <scope>" message.
 * `source` is provided by the API after a verified SSO callback or a
 * verified passkey assertion: "user" means a per-user override is the
 * deciding policy, "org" means it's the org-wide setting. We never show
 * this when there's no error — listing disabled methods up front would
 * leak admin policy.
 *
 * The wording is shared across SSO and passkey refusals; we strip the
 * leading `sso_`/`passkey_` so adding new sign-in methods later only
 * needs a new entry in RESTRICTION_CODES.
 */
function restrictionMessage(code: string, source: "user" | "org" | null): {
  title: string;
  body: string;
} {
  const scope = source === "user" ? "your account" : "your organisation";
  const kind = code.replace(/^(sso|passkey)_/, "");
  if (kind === "required_provider_mismatch") {
    return {
      title: "Try a different sign-in method",
      body:
        source === "user"
          ? "Your account is restricted to a specific sign-in provider. Use the other button above, or ask your administrator to update your access."
          : "This organisation requires a specific sign-in provider. Use the other button above, or contact your administrator if you think this is wrong.",
    };
  }
  if (kind === "provider_disabled") {
    return {
      title: "That sign-in provider is turned off",
      body: `That provider has been disabled for ${scope}. Try a different button above, or contact your administrator.`,
    };
  }
  // method_not_allowed
  return {
    title: "Sign-in method not available",
    body: `That sign-in method isn't enabled for ${scope}. Try a different button above, or contact your administrator if you think this is wrong.`,
  };
}

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.24 1.4-1.7 4.1-5.5 4.1-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.7 3.2 14.6 2.2 12 2.2 6.5 2.2 2.1 6.6 2.1 12.1S6.5 22 12 22c6.9 0 11.5-4.9 11.5-11.7 0-.8-.1-1.4-.2-2.1H12z"
    />
  </svg>
);

const MicrosoftIcon = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
    <rect x="2" y="2" width="9" height="9" fill="#F25022" />
    <rect x="13" y="2" width="9" height="9" fill="#7FBA00" />
    <rect x="2" y="13" width="9" height="9" fill="#00A4EF" />
    <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
  </svg>
);

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoading, refresh } = useAuth();

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get("error");
  const sourceParam = params.get("source");
  const errorSource: "user" | "org" | null =
    sourceParam === "user" || sourceParam === "org" ? sourceParam : null;
  const isRestrictionError = !!errorCode && RESTRICTION_CODES.has(errorCode);
  // The restriction callout is driven by local state (not the URL param
  // alone) so that the passkey flow — which fails via fetch, not via a
  // top-level redirect — can populate it without a page reload.
  const initialRestriction = isRestrictionError
    ? { code: errorCode!, source: errorSource }
    : null;
  // Restriction errors get the dedicated callout (rendered above the buttons),
  // so we don't double-render them in the small inline alert below the form.
  const initialError =
    errorCode && !isRestrictionError ? ERRORS[errorCode] || ERRORS.server_error : null;
  const redirectTarget = (() => {
    const r = params.get("redirect_url");
    if (!r) return "/dashboard";
    // Only allow same-origin paths under /app to avoid open-redirect.
    try {
      const url = new URL(r, window.location.origin);
      if (url.origin !== window.location.origin) return "/dashboard";
      const path = url.pathname.replace(/^\/app/, "") || "/dashboard";
      return path + url.search;
    } catch {
      return "/dashboard";
    }
  })();

  // If the user is already signed in (e.g. landed here after a successful magic-link
  // verify, or after a passkey sign-in that just refreshed the session), redirect them
  // out of the sign-in page so they don't get stuck in a loop.
  useEffect(() => {
    if (!isLoading && isSignedIn) {
      setLocation(redirectTarget);
    }
  }, [isSignedIn, isLoading, setLocation, redirectTarget]);

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(initialError);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  // OTP code entry — shown alongside the "Check your email" screen so users
  // whose Outlook + Defender Safe Links setup breaks the magic-link click
  // flow can type the 6-digit code from the email instead. The code-entry
  // path runs in the user's real browser tab (not the email client's
  // WebView) so the session cookie reliably lands in the right jar.
  const [code, setCode] = useState("");
  const [codeSubmitting, setCodeSubmitting] = useState(false);
  const [codeErr, setCodeErr] = useState<string | null>(null);
  const [restrictionState, setRestrictionState] = useState<
    { code: string; source: "user" | "org" | null } | null
  >(initialRestriction);
  const restriction = restrictionState
    ? restrictionMessage(restrictionState.code, restrictionState.source)
    : null;

  async function requestMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Request failed");
      }
      setSent(true);
      setCode("");
      setCodeErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  // Map server-side error codes from POST /api/auth/magic-link/code into the
  // short, friendly phrases shown under the input. Keeping the strings here
  // (not on the server) lets us tune wording without a redeploy of the API.
  function codeErrorMessage(code: string): string {
    switch (code) {
      case "invalid_code":
        return "That code didn't match. Double-check the 6 digits from your email and try again.";
      case "already_used":
        return "That code was already used. Request a new sign-in email below.";
      case "too_many_attempts":
        return "Too many attempts. Request a new sign-in email below.";
      default:
        return "Something went wrong. Please try again.";
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setCodeErr(null);
    const cleaned = code.replace(/\D/g, "");
    if (cleaned.length !== 6) {
      setCodeErr("Enter the 6-digit code from your email.");
      return;
    }
    setCodeSubmitting(true);
    try {
      const res = await fetch("/api/auth/magic-link/code", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          code: cleaned,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        redirect?: string;
      };
      if (!res.ok || !data.ok) {
        setCodeErr(codeErrorMessage(data.error || "server_error"));
        return;
      }
      // Session is now bound in THIS browser tab. Refresh auth state so the
      // useEffect above (and any other auth-aware UI) picks it up, then
      // navigate to where the server told us to land. We honour the original
      // redirect_url if it points somewhere in /app; otherwise use the
      // server-suggested destination.
      await refresh();
      const target = redirectTarget !== "/dashboard"
        ? redirectTarget
        : (data.redirect || "/dashboard");
      setLocation(target);
    } catch (e) {
      setCodeErr((e as Error).message || "Something went wrong. Please try again.");
    } finally {
      setCodeSubmitting(false);
    }
  }

  async function passkeySignIn() {
    setErr(null);
    // Clear any previous restriction callout — if the previous attempt
    // hit a policy refusal but the user has since changed email, we don't
    // want a stale amber banner sitting above the buttons.
    setRestrictionState(null);
    setPasskeyBusy(true);
    try {
      await signInWithPasskey(email.trim().toLowerCase() || undefined);
      // Re-fetch the session so the AuthProvider updates, then navigate. The
      // useEffect above will also catch isSignedIn flipping to true and redirect.
      await refresh();
      setLocation(redirectTarget);
    } catch (e) {
      // Policy refusal → render the same friendly amber callout that the
      // SSO callback flow uses, with wording derived from policy.source.
      if (e instanceof PasskeyRestrictionError) {
        setRestrictionState({ code: e.code, source: e.source });
        return;
      }
      const msg = (e as Error).message;
      // User-cancelled or no-credentials errors come through as DOM exceptions.
      if (/notallowed|aborted|cancel/i.test(msg)) {
        setErr("Passkey sign-in was cancelled.");
      } else {
        setErr(msg || "Passkey sign-in failed.");
      }
    } finally {
      setPasskeyBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/8 blur-[100px] rounded-full pointer-events-none" />
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-border/60 bg-card shadow-2xl shadow-primary/10 p-8">
          <div className="flex justify-center mb-6 text-foreground" aria-label="EnviroIQ">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 240 64"
              className="h-10 w-auto"
              role="img"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="eiqGradSignin" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="100%" stopColor="#22c55e" />
                </linearGradient>
              </defs>
              <g transform="translate(8 12)">
                <circle cx="20" cy="20" r="18" fill="none" stroke="url(#eiqGradSignin)" strokeWidth="3" />
                <path
                  d="M12 24 L20 16 L28 22 L34 14"
                  fill="none"
                  stroke="url(#eiqGradSignin)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="34" cy="14" r="2.5" fill="url(#eiqGradSignin)" />
              </g>
              <text
                x="60"
                y="40"
                fontFamily="Inter, system-ui, -apple-system, sans-serif"
                fontSize="22"
                fontWeight="700"
                fill="currentColor"
              >
                Enviro
                <tspan fill="url(#eiqGradSignin)">IQ</tspan>
              </text>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-center text-foreground mb-2">Sign in to EnviroIQ</h1>
          <p className="text-center text-muted-foreground text-sm mb-6">
            Audit-grade ESG, ready when you are.
          </p>

          {sent ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
                <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-3" />
                <h2 className="text-base font-semibold text-foreground mb-1">Check your email</h2>
                <p className="text-sm text-muted-foreground">
                  If <span className="text-foreground font-medium">{email}</span> is registered, a sign-in link
                  and a 6-digit code are on their way. They expire in 15 minutes.
                </p>
              </div>

              {/* Code-entry fallback. Critical for Outlook/Defender users
                  where the magic-link click opens in an isolated WebView
                  cookie jar and never carries the session back to the
                  user's real browser tab. Entering the code here runs the
                  fetch from THIS tab, so the cookie lands correctly. */}
              <form
                onSubmit={submitCode}
                className="rounded-lg border border-border/60 bg-card p-5 space-y-3"
                data-testid="form-magic-link-code"
              >
                <div>
                  <label
                    htmlFor="otp-code"
                    className="block text-sm font-medium text-foreground mb-1"
                  >
                    Or enter the 6-digit code from your email
                  </label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Use this if the sign-in link bounces you back to this page
                    (common on Outlook + Microsoft Defender).
                  </p>
                  <input
                    id="otp-code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9 ]*"
                    maxLength={7}
                    autoFocus
                    value={code}
                    onChange={(e) => {
                      // Strip non-digits and re-format as "123 456" for
                      // readability. We keep the raw value short (max 6
                      // digits) and tolerate a space in the middle.
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(
                        digits.length > 3
                          ? `${digits.slice(0, 3)} ${digits.slice(3)}`
                          : digits,
                      );
                      if (codeErr) setCodeErr(null);
                    }}
                    placeholder="123 456"
                    className="w-full h-12 px-3 rounded-md bg-input border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none text-foreground text-center text-xl tracking-[0.3em] font-mono"
                    data-testid="input-magic-link-code"
                  />
                </div>
                <button
                  type="submit"
                  disabled={codeSubmitting || code.replace(/\D/g, "").length !== 6}
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                  data-testid="button-verify-code"
                >
                  {codeSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="h-4 w-4" />
                  )}
                  Sign in with code
                </button>
                {codeErr && (
                  <div
                    className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start"
                    role="alert"
                    data-testid="alert-code-error"
                  >
                    <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive-foreground">{codeErr}</p>
                  </div>
                )}
              </form>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setEmail("");
                    setCode("");
                    setCodeErr(null);
                  }}
                  className="text-xs text-primary hover:underline"
                  data-testid="button-different-email"
                >
                  Use a different email
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Restriction callout — shown only when the IdP authenticated
                  the user but their org/account policy refused the chosen
                  method. Rendered above the buttons so it's the first thing
                  the user sees, with concrete next steps. */}
              {restriction && (
                <div
                  className="mb-5 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
                  role="alert"
                  data-testid="alert-method-restricted"
                >
                  <div className="flex gap-3">
                    <ShieldAlert className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <h2 className="text-sm font-semibold text-foreground">{restriction.title}</h2>
                      <p className="text-sm text-muted-foreground">{restriction.body}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* SSO buttons — full-page navigation, not fetch, so the browser
                  follows the provider 302 redirect. */}
              <div className="space-y-2.5 mb-3">
                <a
                  href="/api/auth/sso/google/start"
                  className="w-full h-11 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors text-foreground font-medium inline-flex items-center justify-center gap-2"
                  data-testid="link-sso-google"
                >
                  <GoogleIcon />
                  Continue with Google
                </a>
                <a
                  href="/api/auth/sso/microsoft/start"
                  className="w-full h-11 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors text-foreground font-medium inline-flex items-center justify-center gap-2"
                  data-testid="link-sso-microsoft"
                >
                  <MicrosoftIcon />
                  Continue with Microsoft
                </a>
              </div>

              {/* Generic, non-enumerating hint. Tells legitimate users why a
                  button might not work without revealing whose account is
                  restricted to what — every user sees the same text. */}
              <p
                className="flex items-start gap-1.5 text-xs text-muted-foreground"
                data-testid="text-method-hint"
              >
                <Info className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <span>Some sign-in methods may be disabled by your administrator.</span>
              </p>

              <div className="mt-5 mb-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-border/60" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="h-px flex-1 bg-border/60" />
              </div>

              <form onSubmit={requestMagicLink} className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
                    Work email
                  </label>
                  <input
                    id="email"
                    type="email"
                    required
                    autoComplete="email"
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.co.nz"
                    className="w-full h-11 px-3 rounded-md bg-input border border-border focus:border-primary focus:ring-1 focus:ring-primary outline-none text-foreground"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting || !email}
                  className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                  Email me a sign-in link
                </button>
              </form>

              {isPasskeySupported() && (
                <>
                  <div className="my-5 flex items-center gap-3">
                    <div className="h-px flex-1 bg-border/60" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="h-px flex-1 bg-border/60" />
                  </div>
                  <button
                    type="button"
                    onClick={passkeySignIn}
                    disabled={passkeyBusy}
                    className="w-full h-11 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors text-foreground font-medium inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {passkeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                    Sign in with a passkey
                  </button>
                </>
              )}

              {err && (
                <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 flex gap-2 items-start">
                  <AlertCircle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
                  <p className="text-sm text-destructive-foreground">{err}</p>
                </div>
              )}
            </>
          )}

          <p className="text-xs text-muted-foreground text-center mt-6">
            By continuing you agree to EnviroIQ&apos;s terms of service and privacy policy.
          </p>
        </div>
      </div>
    </div>
  );
}
