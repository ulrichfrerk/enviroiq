import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Leaf, Loader2, ShieldX, ArrowRight } from "lucide-react";

type OrgInfo = { id: string; name: string; slug: string; logoUrl?: string | null };

/**
 * Per-organisation white-label landing at `/:slug`.
 *
 * Post-Clerk migration this page no longer hosts the auth UI itself — it
 * looks up the org by slug, shows a branded card, and (when the visitor is
 * not yet authenticated) sends them to the central Clerk `/sign-in` flow.
 * Once Clerk reports a session, requireAuth on the API server enforces
 * organisation membership; here we simply route them to /dashboard if their
 * Clerk-linked user belongs to this org (or is a super_admin).
 */
export default function OrgLogin() {
  const { slug } = useParams<{ slug: string }>();
  const { session, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgNotFound, setOrgNotFound] = useState(false);

  useEffect(() => {
    if (!slug) return;
    setOrgLoading(true);
    fetch(`/api/organisations/public/${encodeURIComponent(slug)}`, { credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          setOrgNotFound(true);
          return;
        }
        setOrgInfo((await res.json()) as OrgInfo);
        setOrgNotFound(false);
      })
      .catch(() => setOrgNotFound(true))
      .finally(() => setOrgLoading(false));
  }, [slug]);

  // Authenticated users that belong here go straight to the dashboard.
  useEffect(() => {
    if (!session?.isAuthenticated || !orgInfo) return;
    const isSuperAdmin = session.role === "super_admin";
    const belongsToOrg = session.organisationId === orgInfo.id;
    if (isSuperAdmin || belongsToOrg) {
      setLocation("/dashboard");
    }
  }, [session, orgInfo, setLocation]);

  if (orgLoading || isLoading) {
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
            No organisation is registered at <span className="font-mono text-foreground">/{slug}</span>. Check the URL or contact your account manager.
          </p>
          <Button variant="outline" onClick={() => setLocation("/sign-in")}>
            Go to sign in
          </Button>
        </Card>
      </div>
    );
  }

  // Authenticated but on the wrong org portal.
  if (session?.isAuthenticated && orgInfo && session.organisationId !== orgInfo.id && session.role !== "super_admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md p-8 text-center space-y-4">
          <ShieldX className="w-12 h-12 text-destructive mx-auto" />
          <h2 className="text-xl font-bold text-foreground">Access Denied</h2>
          <p className="text-muted-foreground text-sm">
            Your account doesn't have access to <span className="font-semibold">{orgInfo.name}</span>. Contact your {orgInfo.name} administrator to be added.
          </p>
          <Button variant="outline" onClick={() => setLocation("/dashboard")}>
            Go to your dashboard
          </Button>
        </Card>
      </div>
    );
  }

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const signInHref = `/sign-in?redirect_url=${encodeURIComponent(`${basePath}/${slug}`)}`;

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

        <Button
          size="lg"
          className="w-full h-14 text-base font-semibold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
          onClick={() => setLocation(signInHref)}
        >
          Sign in to {orgInfo?.name}
          <ArrowRight className="w-5 h-5 ml-2" />
        </Button>
      </Card>
    </div>
  );
}
