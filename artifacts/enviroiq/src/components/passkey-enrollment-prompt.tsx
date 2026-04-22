import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { KeyRound, Loader2, X, ShieldCheck } from "lucide-react";
import { enrollPasskey, isPasskeySupported } from "@/lib/webauthn";
import { toast } from "sonner";

/**
 * Renders a one-time passkey enrolment dialog when the URL contains
 * `?enroll_passkey=1`. Triggered by the magic-link verify endpoint after a
 * user without any passkeys signs in. The user can dismiss ("Maybe later")
 * which removes the flag from the URL but doesn't suppress future prompts.
 */
export function PasskeyEnrollmentPrompt() {
  const [location, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("enroll_passkey") === "1" && isPasskeySupported()) {
      setOpen(true);
    }
  }, [location]);

  function clearFlag() {
    const url = new URL(window.location.href);
    url.searchParams.delete("enroll_passkey");
    window.history.replaceState({}, "", url.toString());
  }

  async function enroll() {
    setBusy(true);
    try {
      await enrollPasskey();
      toast.success("Passkey added — you can sign in with it next time.");
      clearFlag();
      setOpen(false);
    } catch (e) {
      const msg = (e as Error).message;
      if (/notallowed|aborted|cancel/i.test(msg)) {
        toast.error("Passkey setup was cancelled.");
      } else {
        toast.error(msg || "Could not set up passkey.");
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    clearFlag();
    setOpen(false);
    setLocation(location); // ensure router state matches
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/60 bg-card shadow-2xl p-6 relative">
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex justify-center mb-4">
          <div className="h-12 w-12 rounded-full bg-primary/15 flex items-center justify-center">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h2 className="text-lg font-bold text-foreground text-center mb-1">
          Set up a passkey
        </h2>
        <p className="text-sm text-muted-foreground text-center mb-5">
          Skip the email step next time. Use Face ID, Touch ID, Windows Hello,
          or your device PIN to sign in instantly.
        </p>
        <div className="flex flex-col gap-2">
          <button
            onClick={enroll}
            disabled={busy}
            className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Set up passkey
          </button>
          <button
            onClick={dismiss}
            disabled={busy}
            className="w-full h-10 rounded-md border border-border bg-card hover:bg-muted/40 transition-colors text-sm text-muted-foreground"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
