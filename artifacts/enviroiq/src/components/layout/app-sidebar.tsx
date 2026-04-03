import { Link, useLocation } from "wouter";
import {
  BarChart3, Car, Zap, Target, FileText, Settings, Users,
  ShieldAlert, Shield, LogOut, Leaf, UserCircle, Beaker, TrendingDown, Sparkles,
  HeartHandshake, Building2, FolderOpen, Recycle, HardHat,
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

type NavItem = { title: string; url: string; icon: React.ComponentType<{ className?: string }> };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "ESG Overview",
    items: [
      { title: "Dashboard", url: "/dashboard", icon: BarChart3 },
    ],
  },
  {
    label: "Environmental",
    items: [
      { title: "Fleet", url: "/fleet", icon: Car },
      { title: "Energy", url: "/energy", icon: Zap },
      { title: "Waste & Environmental", url: "/waste", icon: Recycle },
      { title: "Targets", url: "/targets", icon: TrendingDown },
      { title: "Scenarios", url: "/scenarios", icon: Beaker },
    ],
  },
  {
    label: "Social",
    items: [
      { title: "Social", url: "/social", icon: HeartHandshake },
      { title: "Supply Chain", url: "/subcontractors", icon: HardHat },
    ],
  },
  {
    label: "Governance",
    items: [
      { title: "Governance", url: "/governance", icon: Building2 },
      { title: "Projects & Contracts", url: "/projects", icon: FolderOpen },
      { title: "Goals", url: "/goals", icon: Target },
    ],
  },
  {
    label: "Reporting",
    items: [
      { title: "Reports", url: "/reports", icon: FileText },
      { title: "Mission Statement", url: "/mission", icon: Sparkles },
    ],
  },
  {
    label: "Account",
    items: [
      { title: "Settings", url: "/settings", icon: Settings },
      { title: "Users", url: "/users", icon: Users },
      { title: "Audit Log", url: "/audit", icon: ShieldAlert },
    ],
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const { session, logout } = useAuth();
  const isSuperAdmin = session?.role === "super_admin";

  const isActive = (url: string) =>
    location === url || (url === "/settings" && location === "/widget");

  return (
    <Sidebar className="border-r border-border bg-sidebar">
      <SidebarHeader className="h-16 flex items-center px-4 border-b border-border/50">
        <div className="flex items-center gap-2 text-primary">
          <Leaf className="w-6 h-6" />
          <span className="font-display font-bold text-xl text-foreground tracking-tight">EnviroIQ</span>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-2">
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

        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              {group.label === "ESG Overview" ? (session?.organisationName || "Organisation") : group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className="hover-elevate active-elevate-2 transition-all group"
                      >
                        <Link href={item.url} className="flex items-center gap-3">
                          <item.icon className={`w-4 h-4 ${active ? "text-primary" : "text-muted-foreground group-hover:text-foreground"}`} />
                          <span className={active ? "font-medium text-foreground" : "text-muted-foreground group-hover:text-foreground"}>
                            {item.title}
                          </span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-border/50">
        <div className="flex items-center justify-between gap-2">
          <Link href="/account" className="flex items-center gap-2 flex-1 min-w-0 rounded-md hover:bg-muted/50 transition-colors px-1 py-1 -mx-1 group">
            <UserCircle className="w-5 h-5 text-muted-foreground group-hover:text-primary flex-shrink-0 transition-colors" />
            <div className="flex flex-col overflow-hidden">
              <span className="text-sm font-medium text-foreground truncate">{session?.name || session?.email}</span>
              <span className="text-xs text-muted-foreground capitalize truncate">{session?.role?.replace("_", " ")}</span>
            </div>
          </Link>
          <Button variant="ghost" size="icon" onClick={logout} className="hover-elevate text-muted-foreground hover:text-destructive flex-shrink-0">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
