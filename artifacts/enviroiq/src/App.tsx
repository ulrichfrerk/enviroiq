import React from "react";
// build-marker: 2026-04-21T22:00 forcing rebuild to pick up new VITE_CLERK_PUBLISHABLE_KEY
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import OrgLogin from "@/pages/org-login";

import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Fleet from "@/pages/fleet";
import Energy from "@/pages/energy";
import Goals from "@/pages/goals";
import Targets from "@/pages/targets";
import Scenarios from "@/pages/scenarios";
import Recommendations from "@/pages/recommendations";
import MissionStatement from "@/pages/mission";
import Reports from "@/pages/reports";
import Users from "@/pages/users";
import Admin from "@/pages/admin";
import Audit from "@/pages/audit";
import Compliance from "@/pages/compliance";
import Widget from "@/pages/widget";
import Account from "@/pages/account";
import SettingsPage from "@/pages/settings";
import Social from "@/pages/social";
import Governance from "@/pages/governance";
import Projects from "@/pages/projects";
import Waste from "@/pages/waste";
import Subcontractors from "@/pages/subcontractors";
import Advisor from "@/pages/advisor";
import OnboardingWizard from "@/pages/onboarding-wizard";
import Suppliers from "@/pages/suppliers";
import SupplierReports from "@/pages/supplier-reports";
import PublicAudit from "@/pages/public-audit";
import SupplierPortalLogin from "@/pages/portal/login";
import SupplierPortalHome from "@/pages/portal/index";
import ApiKeys from "@/pages/api-keys";

import { AppLayout } from "@/components/layout/app-layout";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY in environment");
}

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const clerkAppearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(160 84% 39%)",
    colorBackground: "hsl(222.2 84% 4.9%)",
    colorInputBackground: "hsl(217.2 32.6% 12%)",
    colorText: "hsl(210 40% 98%)",
    colorTextSecondary: "hsl(215 20.2% 70%)",
    colorInputText: "hsl(210 40% 98%)",
    colorNeutral: "hsl(210 40% 98%)",
    borderRadius: "0.75rem",
    fontFamily: "Inter, system-ui, -apple-system, sans-serif",
    fontFamilyButtons: "Inter, system-ui, -apple-system, sans-serif",
    fontSize: "0.95rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox:
      "rounded-2xl w-full overflow-hidden border border-border/60 shadow-2xl shadow-primary/10 bg-card",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none px-2 py-2",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: { color: "hsl(210, 40%, 98%)", fontWeight: "600" },
    headerSubtitle: { color: "hsl(215, 20.2%, 70%)" },
    socialButtonsBlockButtonText: { color: "hsl(210, 40%, 98%)" },
    formFieldLabel: { color: "hsl(210, 40%, 98%)" },
    footerActionLink: { color: "hsl(160, 84%, 49%)", fontWeight: "500" },
    footerActionText: { color: "hsl(215, 20.2%, 70%)" },
    dividerText: { color: "hsl(215, 20.2%, 60%)" },
    identityPreviewEditButton: { color: "hsl(160, 84%, 49%)" },
    formFieldSuccessText: { color: "hsl(160, 84%, 49%)" },
    alertText: { color: "hsl(210, 40%, 98%)" },
    logoBox: "justify-center mb-2",
    logoImage: "h-10",
    socialButtonsBlockButton:
      "border border-border/60 bg-card hover:bg-muted/40 transition-colors",
    formButtonPrimary:
      "bg-primary text-primary-foreground hover:bg-primary/90 font-medium",
    formFieldInput:
      "bg-input border-border focus:border-primary focus:ring-1 focus:ring-primary",
    footerAction: "text-center",
    dividerLine: "bg-border/60",
    alert: "border border-border/60 bg-muted/30",
    otpCodeFieldInput: "bg-input border-border",
    formFieldRow: "space-y-1.5",
    main: "gap-4",
  },
};

function SignInPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/8 blur-[100px] rounded-full pointer-events-none" />
      <div className="relative z-10 w-full max-w-md">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          fallbackRedirectUrl={`${basePath}/dashboard`}
        />
      </div>
    </div>
  );
}

function SignUpPage() {
  // To update login providers, app branding, or OAuth settings use the Auth
  // pane in the workspace toolbar. More information can be found in the Replit docs.
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 relative overflow-hidden">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/8 blur-[100px] rounded-full pointer-events-none" />
      <div className="relative z-10 w-full max-w-md">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in`}
          fallbackRedirectUrl={`${basePath}/dashboard`}
        />
      </div>
    </div>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function SessionErrorScreen({ error, onSignOut }: { error: { status?: number; message?: string } | null; onSignOut: () => void }) {
  const status = error?.status;
  const isBlocked = status === 403;
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-border/60 bg-card p-8 shadow-2xl">
        <h2 className="text-xl font-bold text-foreground">
          {isBlocked ? "Account unavailable" : "We couldn't load your account"}
        </h2>
        <p className="text-muted-foreground text-sm">
          {error?.message ||
            (isBlocked
              ? "Your account or organisation is currently locked. Please contact your administrator."
              : "Something went wrong while loading your session. Please try signing in again.")}
        </p>
        <button
          onClick={onSignOut}
          className="inline-flex items-center justify-center gap-2 h-11 px-6 rounded-md bg-primary text-primary-foreground font-medium hover:bg-primary/90"
        >
          Sign out and return to sign in
        </button>
      </div>
    </div>
  );
}

const ProtectedRoute = ({ component: Component }: { component: React.ComponentType }) => {
  const { session, isLoading, sessionError, logout } = useAuth();
  const [location] = useLocation();

  return (
    <>
      <Show when="signed-out">
        <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(basePath + location)}`} />
      </Show>
      <Show when="signed-in">
        {isLoading ? (
          <div className="min-h-screen flex items-center justify-center bg-background">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
          </div>
        ) : sessionError ? (
          <SessionErrorScreen error={sessionError} onSignOut={() => void logout()} />
        ) : !session?.isAuthenticated ? (
          <SessionErrorScreen error={null} onSignOut={() => void logout()} />
        ) : (
          <AppLayout>
            <Component />
          </AppLayout>
        )}
      </Show>
    </>
  );
};

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      {/* Public, no-auth supplier audit form (token-based) */}
      <Route path="/audits/:auditId/:token" component={PublicAudit} />
      {/* Supplier portal (cookie-based magic-link auth) */}
      <Route path="/portal/login" component={SupplierPortalLogin} />
      <Route path="/portal" component={SupplierPortalHome} />
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/fleet"><ProtectedRoute component={Fleet} /></Route>
      <Route path="/energy"><ProtectedRoute component={Energy} /></Route>
      <Route path="/goals"><ProtectedRoute component={Goals} /></Route>
      <Route path="/targets"><ProtectedRoute component={Targets} /></Route>
      <Route path="/scenarios"><ProtectedRoute component={Scenarios} /></Route>
      <Route path="/recommendations"><ProtectedRoute component={Recommendations} /></Route>
      <Route path="/mission"><ProtectedRoute component={MissionStatement} /></Route>
      <Route path="/reports"><ProtectedRoute component={Reports} /></Route>
      <Route path="/users"><ProtectedRoute component={Users} /></Route>
      <Route path="/widget"><ProtectedRoute component={Widget} /></Route>
      <Route path="/settings"><ProtectedRoute component={SettingsPage} /></Route>
      <Route path="/audit"><ProtectedRoute component={Audit} /></Route>
      <Route path="/compliance"><ProtectedRoute component={Compliance} /></Route>
      <Route path="/admin"><ProtectedRoute component={Admin} /></Route>
      <Route path="/api-keys"><ProtectedRoute component={ApiKeys} /></Route>
      <Route path="/account"><ProtectedRoute component={Account} /></Route>
      <Route path="/social"><ProtectedRoute component={Social} /></Route>
      <Route path="/governance"><ProtectedRoute component={Governance} /></Route>
      <Route path="/projects"><ProtectedRoute component={Projects} /></Route>
      <Route path="/waste"><ProtectedRoute component={Waste} /></Route>
      <Route path="/subcontractors"><ProtectedRoute component={Subcontractors} /></Route>
      <Route path="/suppliers"><ProtectedRoute component={Suppliers} /></Route>
      <Route path="/supplier-reports"><ProtectedRoute component={SupplierReports} /></Route>
      <Route path="/advisor"><ProtectedRoute component={Advisor} /></Route>
      <Route path="/onboard-org"><ProtectedRoute component={OnboardingWizard} /></Route>
      <Route path="/:slug" component={OrgLogin} />
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      localization={{
        signIn: { start: { title: "Welcome to EnviroIQ", subtitle: "Sign in to access your sustainability workspace" } },
        signUp: { start: { title: "Create your EnviroIQ account", subtitle: "Audit-grade ESG, ready when you are" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Router />
          <Toaster />
          <SonnerToaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
