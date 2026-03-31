import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useVerifyMagicLink } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Leaf, Loader2, CheckCircle2, XCircle } from "lucide-react";

type Status = "verifying" | "success" | "error";

export default function Verify() {
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<Status>("verifying");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const verifyMutation = useVerifyMagicLink();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    if (!token) {
      setStatus("error");
      setErrorMessage("No verification token found in this link. Please request a new magic link.");
      return;
    }

    verifyMutation.mutate(
      { data: { token } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/auth/session"] });
          setStatus("success");
          const returnTo = localStorage.getItem("enviroiq_return_to");
          if (returnTo) {
            localStorage.removeItem("enviroiq_return_to");
            setTimeout(() => setLocation(returnTo), 1500);
          } else {
            // No intended destination — prompt passkey setup on first login
            setTimeout(() => setLocation("/account?setup=passkey"), 1500);
          }
        },
        onError: (err: unknown) => {
          setStatus("error");
          const apiErr = err as { response?: { data?: { message?: string } }; message?: string };
          setErrorMessage(
            apiErr?.response?.data?.message ||
              apiErr?.message ||
              "This link is invalid or has expired. Please request a new one.",
          );
        },
      },
    );
  }, []);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background">
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[100px] rounded-full pointer-events-none" />

      <Card className="relative z-10 w-full max-w-md p-8 glass-panel animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-emerald-500 flex items-center justify-center mb-6 shadow-lg shadow-primary/25">
            <Leaf className="w-8 h-8 text-primary-foreground" />
          </div>
          <h1 className="text-3xl font-display font-bold text-foreground tracking-tight mb-2">EnviroIQ</h1>
        </div>

        <div className="flex flex-col items-center gap-4 py-4">
          {status === "verifying" && (
            <>
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-foreground font-medium">Verifying your magic link&hellip;</p>
              <p className="text-sm text-muted-foreground">You will be redirected automatically.</p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle2 className="w-10 h-10 text-emerald-500" />
              <p className="text-foreground font-medium">Verified! Signing you in&hellip;</p>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="w-10 h-10 text-destructive" />
              <p className="text-foreground font-semibold">Verification failed</p>
              <p className="text-sm text-muted-foreground text-center">{errorMessage}</p>
              <Button className="mt-2 w-full h-12" onClick={() => setLocation("/login")}>
                Return to login
              </Button>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
