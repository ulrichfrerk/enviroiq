import { useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Mail, KeyRound, CheckCircle2, AlertCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isPasskeySupported, signInWithPasskey } from "@/lib/webauthn";

const ERRORS: Record<string, string> = {
  expired: "That sign-in link has expired or already been used. Request a new one below.",
  already_used: "That sign-in link was already used. Please request a new one.",
  invalid_link: "That link is missing or malformed.",
  account_inactive: "Your account is inactive. Please contact your administrator.",
  server_error: "Something went wrong. Please try again.",
};

export default function SignInPage() {
  const [, setLocation] = useLocation();
  const { refresh } = (() => {
    // Pull refresh through the context without forcing a re-import shape change.
    // (useAuth doesn't currently expose refresh; we re-fetch via reload after passkey.)
    return { refresh: async () => window.location.reload() };
  })();
  void useAuth(); // keep hook usage stable

  const params = new URLSearchParams(window.location.search);
  const errorCode = params.get("error");
  const initialError = errorCode ? ERRORS[errorCode] || ERRORS.server_error : null;

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(initialError);
  const [passkeyBusy, setPasskeyBusy] = useState(false);

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
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function passkeySignIn() {
    setErr(null);
    setPasskeyBusy(true);
    try {
      await signInWithPasskey(email.trim().toLowerCase() || undefined);
      await refresh();
      setLocation("/dashboard");
    } catch (e) {
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
          <div className="flex justify-center mb-6">
            <img src="/app/logo.svg" alt="EnviroIQ" className="h-10" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
          <h1 className="text-2xl font-bold text-center text-foreground mb-2">Sign in to EnviroIQ</h1>
          <p className="text-center text-muted-foreground text-sm mb-6">
            Audit-grade ESG, ready when you are.
          </p>

          {sent ? (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 text-center">
              <CheckCircle2 className="h-8 w-8 text-primary mx-auto mb-3" />
              <h2 className="text-base font-semibold text-foreground mb-1">Check your email</h2>
              <p className="text-sm text-muted-foreground">
                If <span className="text-foreground font-medium">{email}</span> is registered, a sign-in link is on its way.
                It expires in 15 minutes.
              </p>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(""); }}
                className="mt-4 text-xs text-primary hover:underline"
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
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
