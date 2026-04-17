import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { apiClient } from "@/lib/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Key, Plus, Loader2, Copy, Check, XCircle, AlertTriangle, Download,
  ShieldCheck, FileText, BookOpen, Trash2, Activity,
} from "lucide-react";

type Scope = string;

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  scopes: Scope[];
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  revokedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  createdByEmail: string | null;
};

type ScopeCatalog = { scope: Scope; description: string }[];

const ENDPOINTS: {
  method: string;
  path: string;
  scope: string;
  desc: string;
}[] = [
  { method: "GET",   path: "/v1/ping",                                  scope: "—",                  desc: "Verify your key is alive (no scope required)" },
  { method: "GET",   path: "/v1/customers",                             scope: "customers:read",     desc: "Paginated list of customers" },
  { method: "POST",  path: "/v1/customers",                             scope: "customers:write",    desc: "Create a new customer + admin user, returns magic link" },
  { method: "GET",   path: "/v1/customers/{id}",                        scope: "customers:read",     desc: "Read one customer" },
  { method: "PATCH", path: "/v1/customers/{id}",                        scope: "customers:write",    desc: "Update name / industry / lock state" },
  { method: "POST",  path: "/v1/customers/{id}/lock",                   scope: "customers:write",    desc: "Lock account immediately" },
  { method: "POST",  path: "/v1/customers/{id}/unlock",                 scope: "customers:write",    desc: "Unlock account" },
  { method: "GET",   path: "/v1/customers/{id}/users",                  scope: "users:read",         desc: "List users in the customer" },
  { method: "POST",  path: "/v1/customers/{id}/users",                  scope: "users:write",        desc: "Invite user, returns 24h magic link" },
  { method: "PATCH", path: "/v1/customers/{id}/users/{userId}",         scope: "users:write",        desc: "Change role / activate / deactivate" },
  { method: "DELETE",path: "/v1/customers/{id}/users/{userId}",         scope: "users:write",        desc: "Soft-deactivate a user" },
  { method: "GET",   path: "/v1/customers/{id}/metrics",                scope: "metrics:read",       desc: "ESG snapshot — score, total CO₂e, energy" },
  { method: "GET",   path: "/v1/customers/{id}/audits",                 scope: "audits:read",        desc: "Supplier audit summary + recent — drives CRM reminders" },
  { method: "GET",   path: "/v1/customers/{id}/billing",                scope: "billing:read",       desc: "Read plan + billing status" },
  { method: "PATCH", path: "/v1/customers/{id}/billing",                scope: "billing:write",      desc: "Change plan / mark past_due / suspend" },
];

export default function ApiKeysPage() {
  const { session } = useAuth();
  const { toast } = useToast();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [scopes, setScopes] = useState<ScopeCatalog>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createScopes, setCreateScopes] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [createdKey, setCreatedKey] = useState<{ name: string; fullKey: string; prefix: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokeId, setRevokeId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [keysRes, scopesRes] = await Promise.all([
        apiClient<{ items: ApiKey[] }>("/crm-keys"),
        apiClient<{ scopes: ScopeCatalog }>("/crm-keys/scopes"),
      ]);
      setKeys(keysRes.items);
      setScopes(scopesRes.scopes);
    } catch (err) {
      toast({ title: "Failed to load API keys", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session?.role === "super_admin") void load();
  }, [session?.role]);

  async function handleCreate() {
    if (createName.trim().length < 3) {
      toast({ title: "Name too short", description: "At least 3 characters", variant: "destructive" });
      return;
    }
    if (createScopes.size === 0) {
      toast({ title: "Pick at least one scope", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const result = await apiClient<{ name: string; fullKey: string; prefix: string }>("/crm-keys", {
        method: "POST",
        body: { name: createName.trim(), scopes: [...createScopes] },
      });
      setCreatedKey({ name: result.name, fullKey: result.fullKey, prefix: result.prefix });
      setCreateOpen(false);
      setCreateName("");
      setCreateScopes(new Set());
      void load();
    } catch (err) {
      toast({ title: "Failed to create key", description: String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeId) return;
    try {
      await apiClient(`/crm-keys/${revokeId}`, { method: "DELETE" });
      toast({ title: "Key revoked" });
      setRevokeId(null);
      void load();
    } catch (err) {
      toast({ title: "Revoke failed", description: String(err), variant: "destructive" });
    }
  }

  function copyFullKey() {
    if (!createdKey) return;
    navigator.clipboard.writeText(createdKey.fullKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  if (session?.role !== "super_admin") {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center gap-4">
        <XCircle className="w-12 h-12 text-destructive" />
        <h2 className="text-xl font-semibold">Access Denied</h2>
        <p className="text-muted-foreground">
          The CRM Integration API is administered by the platform operator. Super Admin access required.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Key className="w-7 h-7 text-primary" />
            CRM Integration API
          </h1>
          <p className="text-muted-foreground mt-1.5 max-w-2xl">
            Issue Bearer API keys so an external CRM can provision customers, invite users,
            lock accounts, update billing, and pull live ESG &amp; supplier-audit metrics.
            Keys are stored as one-way SHA-256 hashes — they are shown to you exactly once at
            creation time.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="shrink-0">
          <Plus className="w-4 h-4 mr-2" /> New API key
        </Button>
      </header>

      <Tabs defaultValue="keys" className="space-y-6">
        <TabsList>
          <TabsTrigger value="keys"><Key className="w-4 h-4 mr-2" />Keys</TabsTrigger>
          <TabsTrigger value="docs"><BookOpen className="w-4 h-4 mr-2" />Documentation</TabsTrigger>
          <TabsTrigger value="security"><ShieldCheck className="w-4 h-4 mr-2" />Security</TabsTrigger>
          <TabsTrigger value="spec"><FileText className="w-4 h-4 mr-2" />Spec sheet</TabsTrigger>
        </TabsList>

        {/* ----------------------------- KEYS LIST ----------------------------- */}
        <TabsContent value="keys" className="space-y-4">
          <Card className="overflow-hidden">
            <div className="px-5 py-3 border-b bg-muted/30 grid grid-cols-12 gap-4 text-xs font-mono uppercase tracking-wider text-muted-foreground">
              <div className="col-span-3">Name</div>
              <div className="col-span-3">Prefix</div>
              <div className="col-span-3">Scopes</div>
              <div className="col-span-2">Last used</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
            {loading ? (
              <div className="py-12 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : keys.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                <Key className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <div>No API keys yet — create your first one above.</div>
              </div>
            ) : (
              keys.map((k) => {
                const revoked = !!k.revokedAt;
                return (
                  <div key={k.id} className={`px-5 py-4 border-t grid grid-cols-12 gap-4 items-center ${revoked ? "opacity-50" : ""}`}>
                    <div className="col-span-3">
                      <div className="font-medium">{k.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Created {new Date(k.createdAt).toLocaleDateString()} {k.createdByEmail ? `· by ${k.createdByEmail}` : ""}
                      </div>
                    </div>
                    <div className="col-span-3">
                      <code className="font-mono text-sm bg-muted px-2 py-0.5 rounded">{k.prefix}…</code>
                      {revoked && <Badge variant="destructive" className="ml-2">Revoked</Badge>}
                    </div>
                    <div className="col-span-3 flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="text-xs font-mono">{s}</Badge>
                      ))}
                    </div>
                    <div className="col-span-2 text-sm text-muted-foreground">
                      {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                      {k.lastUsedIp && <div className="text-xs font-mono">{k.lastUsedIp}</div>}
                    </div>
                    <div className="col-span-1 text-right">
                      {!revoked && (
                        <Button variant="ghost" size="icon" onClick={() => setRevokeId(k.id)} title="Revoke">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </Card>
        </TabsContent>

        {/* ----------------------------- DOCS TAB ----------------------------- */}
        <TabsContent value="docs" className="space-y-6">
          <Card className="p-6">
            <h2 className="text-xl font-semibold flex items-center gap-2 mb-1">
              <Activity className="w-5 h-5 text-primary" /> Quick start
            </h2>
            <p className="text-sm text-muted-foreground mb-4">
              All requests use HTTPS, JSON, and a standard <code className="font-mono">Authorization: Bearer</code> header.
              Base URL: <code className="font-mono bg-muted px-1.5 py-0.5 rounded">https://enviroiq.net/api/v1</code>
            </p>

            <pre className="bg-zinc-950 text-zinc-100 p-4 rounded-lg text-sm overflow-x-auto font-mono leading-relaxed">
{`# 1. Verify your key
curl https://enviroiq.net/api/v1/ping \\
  -H "Authorization: Bearer eiq_live_..."

# 2. Create a customer (returns magic-link URL)
curl -X POST https://enviroiq.net/api/v1/customers \\
  -H "Authorization: Bearer eiq_live_..." \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Acme Logistics",
    "adminEmail": "ceo@acme.co.nz",
    "adminName": "Jane Smith",
    "plan": "assure"
  }'

# 3. Pull live audit metrics (sync to your CRM nightly)
curl https://enviroiq.net/api/v1/customers/{id}/audits \\
  -H "Authorization: Bearer eiq_live_..."`}
            </pre>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Endpoints</h2>
            <div className="space-y-1">
              <div className="grid grid-cols-12 px-3 py-2 text-xs font-mono uppercase tracking-wider text-muted-foreground border-b">
                <div className="col-span-1">Method</div>
                <div className="col-span-5">Path</div>
                <div className="col-span-2">Required scope</div>
                <div className="col-span-4">Description</div>
              </div>
              {ENDPOINTS.map((e) => (
                <div key={`${e.method}-${e.path}`} className="grid grid-cols-12 px-3 py-2.5 text-sm hover:bg-muted/40 rounded items-center">
                  <div className="col-span-1">
                    <Badge variant="outline" className={methodBadgeClass(e.method)}>{e.method}</Badge>
                  </div>
                  <div className="col-span-5 font-mono text-sm">{e.path}</div>
                  <div className="col-span-2">
                    {e.scope === "—" ? <span className="text-muted-foreground text-sm">none</span> :
                      <Badge variant="secondary" className="font-mono text-xs">{e.scope}</Badge>}
                  </div>
                  <div className="col-span-4 text-muted-foreground">{e.desc}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-4">Scopes</h2>
            <div className="space-y-2">
              {scopes.map((s) => (
                <div key={s.scope} className="flex items-start gap-3 px-3 py-2 rounded hover:bg-muted/40">
                  <Badge variant="secondary" className="font-mono text-xs mt-0.5 shrink-0">{s.scope}</Badge>
                  <div className="text-sm text-muted-foreground">{s.description}</div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* ----------------------------- SECURITY TAB ----------------------------- */}
        <TabsContent value="security" className="space-y-4">
          <Card className="p-6 space-y-4">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> Security model
            </h2>
            <ul className="space-y-3 text-sm">
              {[
                ["One-way hashing", "We persist only a SHA-256 hash of every key. The plaintext value is shown to you exactly once at creation time. If lost, revoke and reissue."],
                ["Scoped permissions", "Every key carries a strict scope set. Calls outside those scopes are rejected with 403 — pick the narrowest scopes that work for your CRM."],
                ["Audit trail", "Every authenticated call (success or failure) is recorded in crm_api_key_usage and the global audit log, including method, path, status, IP, timestamp, and key prefix."],
                ["Constant-time comparison", "All key matching uses cryptographic constant-time comparison to prevent timing attacks."],
                ["Revocation is immediate", "Revoked keys are rejected on the next request — no caching window."],
                ["TLS-only", "All traffic is HTTPS; HSTS is enforced. Never put your key in a URL — use the Authorization header."],
                ["Super Admin only", "Only the platform operator can issue keys. Keys are global (not org-scoped) so they can be used by your CRM to act across every customer."],
              ].map(([title, body]) => (
                <li key={title} className="flex gap-3">
                  <Check className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <div><strong>{title}.</strong> <span className="text-muted-foreground">{body}</span></div>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-6 border-amber-500/30 bg-amber-500/5">
            <h3 className="font-semibold flex items-center gap-2 text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-4 h-4" /> If a key leaks
            </h3>
            <ol className="mt-3 space-y-2 text-sm list-decimal list-inside text-muted-foreground">
              <li>Revoke the key in the Keys tab — takes effect immediately.</li>
              <li>Issue a new key with the same scopes and update your CRM secrets store.</li>
              <li>Review the audit log (<code className="font-mono">/audit</code>) for any unexpected activity from that key prefix.</li>
            </ol>
          </Card>
        </TabsContent>

        {/* ----------------------------- SPEC TAB ----------------------------- */}
        <TabsContent value="spec" className="space-y-4">
          <Card className="p-6">
            <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Downloadable spec sheet
            </h2>
            <p className="text-muted-foreground text-sm mb-5 max-w-2xl">
              Hand these files to your CRM developer. The OpenAPI 3.1 JSON drops straight into Postman,
              Insomnia, or auto-generates a TypeScript / Python / Go client. The Markdown brief gives a
              human-readable summary for engineering hand-off.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href="/api/v1/openapi.json" download="enviroiq-crm-api.openapi.json">
                  <Download className="w-4 h-4 mr-2" /> OpenAPI 3.1 (JSON)
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/crm-api-spec.md" download>
                  <Download className="w-4 h-4 mr-2" /> Spec sheet (Markdown)
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
                  View OpenAPI in browser
                </a>
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ----------------------------- CREATE DIALOG ----------------------------- */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Pick a descriptive name (e.g. "Sales CRM — production") and the scopes your CRM needs.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Name</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Sales CRM — production"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Scopes</Label>
              <div className="mt-2 space-y-2 max-h-64 overflow-y-auto pr-2">
                {scopes.map((s) => (
                  <label key={s.scope} className="flex items-start gap-3 p-2 rounded hover:bg-muted/40 cursor-pointer">
                    <Checkbox
                      checked={createScopes.has(s.scope)}
                      onCheckedChange={(v) => {
                        const next = new Set(createScopes);
                        if (v) next.add(s.scope); else next.delete(s.scope);
                        setCreateScopes(next);
                      }}
                    />
                    <div className="flex-1">
                      <div className="font-mono text-sm">{s.scope}</div>
                      <div className="text-xs text-muted-foreground">{s.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------- "ONE-TIME REVEAL" DIALOG ----------------------------- */}
      <Dialog open={!!createdKey} onOpenChange={(o) => !o && setCreatedKey(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-primary" /> Key created
            </DialogTitle>
            <DialogDescription>
              Copy this key now and store it in your CRM's secrets vault. EnviroIQ will never show it again.
            </DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-3">
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">Name</div>
                <div className="font-medium">{createdKey.name}</div>
              </div>
              <div className="rounded-lg border-2 border-primary bg-primary/5 p-3">
                <div className="text-xs font-mono uppercase tracking-wider text-primary mb-1.5">Full API key (one-time)</div>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-sm break-all flex-1">{createdKey.fullKey}</code>
                  <Button size="sm" variant="outline" onClick={copyFullKey}>
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Use it as <code className="font-mono">Authorization: Bearer {createdKey.prefix}…</code> on every request.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>I've stored it safely</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ----------------------------- REVOKE CONFIRM ----------------------------- */}
      <Dialog open={!!revokeId} onOpenChange={(o) => !o && setRevokeId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this API key?</DialogTitle>
            <DialogDescription>
              The key stops working immediately. Any CRM workflow using it will fail until you issue a new one.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleRevoke}>Revoke key</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function methodBadgeClass(method: string): string {
  switch (method) {
    case "GET": return "border-emerald-500/40 text-emerald-600 dark:text-emerald-400";
    case "POST": return "border-blue-500/40 text-blue-600 dark:text-blue-400";
    case "PATCH": return "border-amber-500/40 text-amber-600 dark:text-amber-400";
    case "DELETE": return "border-red-500/40 text-red-600 dark:text-red-400";
    default: return "";
  }
}
