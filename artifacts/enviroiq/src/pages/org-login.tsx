import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useRequestMagicLink } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Leaf, Fingerprint, Mail, Loader2, MailCheck, ShieldX, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
type OrgInfo = { id: string; name: string; slug: string; logoUrl?: string | null };

export default function OrgLogin() {
  const { slug } = useParams<{ slug: string }>();
  const { session, loginPasskey, isAuthenticating } = useAuth();
  const reqMagicLink = useRequestMagicLink();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgNotFound, setOrgNotFound] = useState(false);
  const [mode, setMode] = useState<"login" | "magic" | "magic-sent">("login");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!slug) return;
    setOrgLoading(true);
    fetch(`/api/organisations/public/${encodeURIComponent(slug)}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) { setOrgNotFound(true); return; }
        setOrgInfo(await res.json() as OrgInfo);
        setOrgNotFound(false);
      })
      .catch(() => setOrgNotFound(true))
      .finally(() => setOrgLoading(false));
  }, [slug]);

  // If authenticated — check org membership
  useEffect(() => {
    if (!session?.isAuthenticated || !orgInfo) return;
    const isSuperAdmin = session.role === "super_admin";
    const belongsToOrg = session.organisationId === orgInfo.id;
    if (isSuperAdmin || belongsToOrg) {
      setLocation("/dashboard");
    }
  }, [session, orgInfo]);

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    // Store the org portal URL so verify page brings user back here for membership check
    localStorage.setItem("enviroiq_return_to", `/${slug}`);
    try {
      await reqMagicLink.mutateAsync({ data: { email } });
      setMode("magic-sent");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send magic link.";
      toast({ variant: "destructive", title: "Error", description: message });
    }
  };

  const handlePasskey = async () => {
    localStorage.setItem("enviroiq_return_to", `/${slug}`);
    await loginPasskey();
  };

  if (orgLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (orgNotFound) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <ShieldX className="w-12 h-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Portal not found</h2>
          <p className="text-muted-foreground text-sm">
            No organisation is registered at <span className="font-mono text-foreground">/{slug}</span>.
            Check the URL or contact your account manager.
          </p>
          <Button variant="outline" className="gap-2" onClick={() => setLocation("/login")}>
            <ArrowLeft className="w-4 h-4" /> Back to login
          </Button>
        </Card>
      </div>
    );
  }

  // Authenticated but wrong org — access denied
  if (session?.isAuthenticated && orgInfo && session.organisationId !== orgInfo.id && session.role !== "super_admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <ShieldX className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground text-sm">
            Your account doesn't have access to <span className="font-semibold">{orgInfo.name}</span>.
            Contact your {orgInfo.name} administrator to be added.
          </p>
          <Button variant="outline" className="gap-2" onClick={() => setLocation("/dashboard")}>
            Go to your dashboard
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-background">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

      <Card className="relative z-10 w-full max-w-md p-8 glass-panel animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="flex flex-col items-center text-center mb-10">
          {orgInfo?.logoUrl ? (
            <img src={orgInfo.logoUrl} alt={orgInfo.name} className="h-14 mb-6 object-contain" />
          ) : (
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-emerald-500 flex items-center justify-center mb-6 shadow-lg shadow-primary/25">
              <Leaf className="w-8 h-8 text-primary-foreground" />
            </div>
          )}
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight mb-1">
            {orgInfo?.name}
          </h1>
          <p className="text-muted-foreground text-sm">Powered by EnviroIQ</p>
        </div>

        {mode === "login" && (
          <div className="space-y-6">
            <Button
              size="lg"
              className="w-full h-14 text-base font-semibold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
              onClick={handlePasskey}
              disabled={isAuthenticating}
            >
              {isAuthenticating ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Fingerprint className="w-5 h-5 mr-2" />}
              Login with Passkey
            </Button>

            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or</span></div>
            </div>

            <Button variant="outline" className="w-full h-12" onClick={() => setMode("magic")}>
              <Mail className="w-4 h-4 mr-2" /> Continue with Email
            </Button>
          </div>
        )}

        {mode === "magic" && (
          <form onSubmit={handleMagicLink} className="space-y-4 animate-in slide-in-from-left-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Work Email</label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="h-12 bg-background/50"
                required
              />
            </div>
            <Button type="submit" className="w-full h-12 mt-2" disabled={reqMagicLink.isPending || !email}>
              {reqMagicLink.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Mail className="w-5 h-5 mr-2" />}
              Send Magic Link
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("login")}>Back</Button>
          </form>
        )}

        {mode === "magic-sent" && (
          <div className="flex flex-col items-center gap-4 animate-in fade-in">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <MailCheck className="w-7 h-7 text-emerald-500" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-semibold text-foreground">Check your email</p>
              <p className="text-sm text-muted-foreground">
                We sent a magic link to <span className="font-medium text-foreground">{email}</span>.
              </p>
              <p className="text-xs text-muted-foreground pt-1">The link expires in 15 minutes.</p>
            </div>
            <Button variant="ghost" className="w-full mt-2" onClick={() => setMode("magic")}>Try a different email</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
