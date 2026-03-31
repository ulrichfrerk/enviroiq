import { ReactNode } from "react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "./app-sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";

export function AppLayout({ children }: { children: ReactNode }) {
  const { isLoading, session } = useAuth();
  const [location] = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading EnviroIQ...</p>
      </div>
    );
  }

  // Session check handled by individual routes or router wrapper, 
  // but we ensure layout doesn't crash if session is missing
  if (!session?.isAuthenticated) {
    return <>{children}</>; 
  }

  const style = {
    "--sidebar-width": "16rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full bg-background overflow-hidden text-foreground">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="h-16 flex items-center justify-between px-6 border-b border-border/50 bg-card/50 backdrop-blur-md z-10 sticky top-0">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="hover-elevate text-muted-foreground hover:text-foreground" />
              <h2 className="text-sm font-medium text-muted-foreground">
                {session.organisationName} <span className="mx-2 text-border">•</span> {session.role === 'super_admin' ? 'Platform Management' : 'ESG Portal'}
              </h2>
            </div>
            {session.role === "super_admin" && (
              <Button
                asChild
                size="sm"
                variant={location === "/admin" ? "default" : "outline"}
                className={`gap-2 font-medium transition-all ${
                  location === "/admin"
                    ? "bg-primary text-primary-foreground shadow-lg shadow-primary/25"
                    : "border-primary/40 text-primary hover:bg-primary/10 hover:border-primary"
                }`}
              >
                <Link href="/admin">
                  <Shield className="w-3.5 h-3.5" />
                  Admin
                </Link>
              </Button>
            )}
          </header>
          <main className="flex-1 overflow-y-auto p-6 md:p-8 animate-in fade-in duration-500">
            <div className="max-w-7xl mx-auto">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
