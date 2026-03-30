import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useRequestMagicLink } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Leaf, Fingerprint, Mail, ArrowRight, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const { session, loginPasskey, registerPasskey, isAuthenticating, isRegistering } = useAuth();
  const reqMagicLink = useRequestMagicLink();
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [mode, setMode] = useState<"login" | "register" | "magic">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  if (session?.isAuthenticated) {
    setLocation("/dashboard");
    return null;
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    try {
      await reqMagicLink.mutateAsync({ data: { email } });
      toast({ title: "Email sent", description: "Check your inbox for the magic link." });
      setMode("login");
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err.message || "Failed to send magic link." });
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center relative overflow-hidden bg-background">
      {/* Abstract Background Elements */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

      {/* user uploaded image for background if needed, but CSS gradient meshes look more modern for this app type */}
      <img 
        src={`${import.meta.env.BASE_URL}images/auth-bg.png`} 
        alt="Background" 
        className="absolute inset-0 w-full h-full object-cover opacity-20 pointer-events-none mix-blend-screen"
      />

      <Card className="relative z-10 w-full max-w-md p-8 glass-panel animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-emerald-500 flex items-center justify-center mb-6 shadow-lg shadow-primary/25">
            <Leaf className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight mb-2">EnviroIQ</h1>
          <p className="text-muted-foreground text-sm">Measure. Report. Improve.</p>
        </div>

        {mode === "login" && (
          <div className="space-y-6">
            <Button 
              size="lg" 
              className="w-full h-14 text-base font-semibold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all"
              onClick={() => loginPasskey()}
              disabled={isAuthenticating}
            >
              {isAuthenticating ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Fingerprint className="w-5 h-5 mr-2" />}
              Login with Passkey
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border"></div></div>
              <div className="relative flex justify-center text-xs uppercase"><span className="bg-card px-2 text-muted-foreground">Or</span></div>
            </div>

            <div className="space-y-3">
              <Button variant="outline" className="w-full h-12" onClick={() => setMode("magic")}>
                <Mail className="w-4 h-4 mr-2" /> Continue with Email
              </Button>
              <Button variant="ghost" className="w-full h-12 text-muted-foreground hover:text-foreground" onClick={() => setMode("register")}>
                First time? Setup Passkey <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </div>
        )}

        {mode === "register" && (
          <div className="space-y-4 animate-in slide-in-from-right-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email Address</label>
              <Input 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="you@company.com" 
                className="h-12 bg-background/50"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Full Name</label>
              <Input 
                value={name} 
                onChange={e => setName(e.target.value)} 
                placeholder="Jane Doe" 
                className="h-12 bg-background/50"
              />
            </div>
            <Button 
              className="w-full h-12 mt-2" 
              disabled={!email || !name || isRegistering}
              onClick={() => registerPasskey(email, name)}
            >
              {isRegistering ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Fingerprint className="w-5 h-5 mr-2" />}
              Create Passkey
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setMode("login")}>Back to login</Button>
          </div>
        )}

        {mode === "magic" && (
          <form onSubmit={handleMagicLink} className="space-y-4 animate-in slide-in-from-left-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Email Address</label>
              <Input 
                type="email"
                value={email} 
                onChange={e => setEmail(e.target.value)} 
                placeholder="you@company.com" 
                className="h-12 bg-background/50"
                required
              />
            </div>
            <Button type="submit" className="w-full h-12 mt-2" disabled={reqMagicLink.isPending || !email}>
              {reqMagicLink.isPending ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Mail className="w-5 h-5 mr-2" />}
              Send Magic Link
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("login")}>Back to login</Button>
          </form>
        )}
      </Card>
    </div>
  );
}
