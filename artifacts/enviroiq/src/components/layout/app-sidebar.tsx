import { Link, useLocation } from "wouter";
import { 
  BarChart3, Car, Zap, Target, FileText, Settings, Users, 
  ShieldAlert, Shield, LogOut, Leaf
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";

export function AppSidebar() {
  const [location] = useLocation();
  const { session, logout } = useAuth();

  const isSuperAdmin = session?.role === "super_admin";

  const navItems = [
    { title: "Dashboard", url: "/dashboard", icon: BarChart3 },
    { title: "Fleet", url: "/fleet", icon: Car },
    { title: "Energy", url: "/energy", icon: Zap },
    { title: "Goals", url: "/goals", icon: Target },
    { title: "Reports", url: "/reports", icon: FileText },
    { title: "Widget Settings", url: "/widget", icon: Settings },
    { title: "Users", url: "/users", icon: Users },
    { title: "Audit Log", url: "/audit", icon: ShieldAlert },
  ];

  return (
    <Sidebar className="border-r border-border bg-sidebar">
      <SidebarHeader className="h-16 flex items-center px-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-primary">
          <Leaf className="w-6 h-6" />
          <span className="font-display font-bold text-xl text-foreground tracking-tight">EnviroIQ</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-4">
        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Super Admin
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === "/admin"}
                    className="hover-elevate active-elevate-2 transition-all"
                  >
                    <Link href="/admin" className="flex items-center gap-3">
                      <Shield className="w-4 h-4 text-primary" />
                      <span>Admin Portal</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            {session?.organisationName || "Organisation"}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton 
                    asChild 
                    isActive={location === item.url}
                    className="hover-elevate active-elevate-2 transition-all group"
                  >
                    <Link href={item.url} className="flex items-center gap-3">
                      <item.icon className={`w-4 h-4 ${location === item.url ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                      <span className={location === item.url ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"}>
                        {item.title}
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex flex-col overflow-hidden">
            <span className="text-sm font-medium text-foreground truncate">{session?.name || session?.email}</span>
            <span className="text-xs text-muted-foreground capitalize truncate">{session?.role.replace('_', ' ')}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={logout} className="hover-elevate text-muted-foreground hover:text-destructive">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
