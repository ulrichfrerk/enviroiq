import { useState } from "react";
import { KeyRound, ShieldCheck, User, Mail, BadgeCheck, Sparkles, ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";

export default function Account() {
  const { session, registerPasskey, isRegistering } = useAuth();
  const [enrolling, setEnrolling] = useState(false);
  const [passkeyDone, setPasskeyDone] = useState(false);
  const [, setLocation] = useLocation();
  const isPostLogin = new URLSearchParams(window.location.search).get("setup") === "passkey";

  const handleEnrollPasskey = async () => {
    if (!session?.email || !session?.name) return;
    setEnrolling(true);
    try {
      await registerPasskey(session.email, session.name);
      setPasskeyDone(true);
    } finally {
      setEnrolling(false);
    }
  };

  const roleLabel = (role: string) =>
    role.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="space-y-8 pb-10 max-w-2xl">
      {/* Post-login passkey setup prompt */}
      {isPostLogin && !passkeyDone && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 flex items-start gap-4">
          <Sparkles className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-foreground">You're signed in — set up a passkey next</p>
            <p className="text-sm text-muted-foreground mt-1">
              Passkeys let you log in with Face ID or Touch ID — no magic link needed next time. Hit <strong>Add a Passkey</strong> below, then go to your dashboard.
            </p>
          </div>
        </div>
      )}

      {/* Passkey enrolled success */}
      {passkeyDone && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 flex items-start gap-4">
          <ShieldCheck className="w-5 h-5 text-emerald-500 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-foreground">Passkey enrolled!</p>
            <p className="text-sm text-muted-foreground mt-1">
              Next time you visit, just tap <strong>Login with Passkey</strong> for instant access.
            </p>
          </div>
          <Button size="sm" className="flex-shrink-0 gap-1.5" onClick={() => setLocation("/dashboard")}>
            Dashboard <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">My Account</h1>
        <p className="text-muted-foreground mt-1">Manage your profile and security settings.</p>
      </div>

      {/* Profile */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="w-5 h-5 text-primary" /> Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 text-muted-foreground">
              <User className="w-4 h-4" />
              <span className="text-sm">Name</span>
            </div>
            <span className="text-sm font-medium text-foreground">{session?.name || "—"}</span>
          </div>
          <Separator className="border-border/50" />
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 text-muted-foreground">
              <Mail className="w-4 h-4" />
              <span className="text-sm">Email</span>
            </div>
            <span className="text-sm font-medium text-foreground">{session?.email || "—"}</span>
          </div>
          <Separator className="border-border/50" />
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-3 text-muted-foreground">
              <BadgeCheck className="w-4 h-4" />
              <span className="text-sm">Role</span>
            </div>
            <Badge variant="secondary" className="capitalize">
              {roleLabel(session?.role || "")}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Security — Passkeys */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5 text-primary" /> Security
          </CardTitle>
          <CardDescription>
            Passkeys let you sign in instantly using Face ID, Touch ID, or your device PIN — no
            password needed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg bg-muted/30 border border-border/50 p-4 text-sm text-muted-foreground">
            Passkeys let you sign in with your fingerprint, face, or device PIN — no password needed.
            Once enrolled, you'll see the "Login with Passkey" button on the sign-in screen.
          </div>

          <div className="space-y-2">
            <Button
              onClick={handleEnrollPasskey}
              disabled={enrolling || isRegistering}
              className="w-full sm:w-auto gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              <KeyRound className="w-4 h-4" />
              {enrolling || isRegistering ? "Setting up passkey…" : "Add a Passkey"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Your browser will prompt you to use Face ID, Touch ID, or your device PIN.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
