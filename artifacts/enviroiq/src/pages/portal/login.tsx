import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Mail, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function SupplierPortalLogin() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes("@")) { toast.error("Enter a valid email"); return; }
    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/request-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setSent(email);
      if (data.url) setDevUrl(data.url);
    } catch { toast.error("Could not send link"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
        <div className="text-center mb-6">
          <ShieldCheck className="h-10 w-10 text-primary mx-auto mb-3" />
          <h1 className="text-2xl font-bold">Supplier portal</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in to view all ESG audits sent to your email.</p>
        </div>

        {sent ? (
          <div className="text-center space-y-3">
            <Mail className="h-10 w-10 text-emerald-500 mx-auto" />
            <h2 className="font-semibold">Check your inbox</h2>
            <p className="text-sm text-muted-foreground">If <span className="font-mono">{sent}</span> matches an audit on file, we&apos;ve emailed a sign-in link. The link expires in 30 minutes.</p>
            {devUrl && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-left text-xs">
                <div className="font-semibold text-amber-700 dark:text-amber-300 mb-1">Dev mode link</div>
                <a href={devUrl} className="text-primary underline break-all">{devUrl}</a>
              </div>
            )}
            <Button variant="outline" className="mt-2" onClick={() => { setSent(null); setDevUrl(null); }}>Use another email</Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label>Email address</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@supplier.co" data-testid="input-portal-email" />
            </div>
            <Button type="submit" className="w-full" disabled={submitting} data-testid="button-portal-submit">
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
              Email me a sign-in link
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
