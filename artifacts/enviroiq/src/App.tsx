import React from "react";
import { Switch, Route, Router as WouterRouter, Redirect, useLocation } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import OrgLogin from "@/pages/org-login";

import Login from "@/pages/login";
import SignInPage from "@/pages/sign-in";
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
import AuditCustomisation from "@/pages/audit-customisation";
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
import NotificationsPage from "@/pages/notifications";
import Inbox from "@/pages/inbox";

import { AppLayout } from "@/components/layout/app-layout";
import { AuthProvider } from "@/providers/auth-provider";
import { useAuth } from "@/hooks/use-auth";
import { PasskeyEnrollmentPrompt } from "@/components/passkey-enrollment-prompt";
import { Loader2 } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function SessionErrorScreen({
  error,
  onSignOut,
}: {
  error: { status?: number; message?: string } | null;
  onSignOut: () => void;
}) {
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
  const { session, isLoading, isSignedIn, sessionError, logout } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSignedIn) {
    return <Redirect to={`/sign-in?redirect_url=${encodeURIComponent(basePath + location)}`} />;
  }

  if (sessionError) {
    return <SessionErrorScreen error={sessionError} onSignOut={() => void logout()} />;
  }

  if (!session?.isAuthenticated) {
    return <SessionErrorScreen error={null} onSignOut={() => void logout()} />;
  }

  return (
    <AppLayout>
      <PasskeyEnrollmentPrompt />
      <Component />
    </AppLayout>
  );
};

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/sign-in" component={SignInPage} />
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
      <Route path="/audit-customisation"><ProtectedRoute component={AuditCustomisation} /></Route>
      <Route path="/compliance"><ProtectedRoute component={Compliance} /></Route>
      <Route path="/admin"><ProtectedRoute component={Admin} /></Route>
      <Route path="/api-keys"><ProtectedRoute component={ApiKeys} /></Route>
      <Route path="/notifications"><ProtectedRoute component={NotificationsPage} /></Route>
      <Route path="/inbox"><ProtectedRoute component={Inbox} /></Route>
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

function App() {
  return (
    <WouterRouter base={basePath}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <TooltipProvider>
            <Router />
            <Toaster />
            <SonnerToaster />
          </TooltipProvider>
        </AuthProvider>
      </QueryClientProvider>
    </WouterRouter>
  );
}

export default App;
