import { createContext, useContext, useCallback, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: "super_admin" | "org_admin" | "org_user" | "org_viewer" | "org_auditor";
  organisationId: string | null;
  organisationName: string | null;
  emailNotificationsEnabled: boolean;
  isAuthenticated: true;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isSignedIn: boolean;
  error: { status?: number; message?: string } | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SESSION_QUERY_KEY = ["auth", "session"] as const;

async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/session", {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    const err: Error & { status?: number } = new Error(
      `Session request failed: ${res.status}`,
    );
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as AuthUser;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: fetchSession,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const refresh = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  }, [qc]);

  const signOut = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      qc.setQueryData(SESSION_QUERY_KEY, null);
      qc.clear();
      window.location.href = "/app/sign-in";
    }
  }, [qc]);

  const value: AuthContextValue = useMemo(
    () => ({
      user: data ?? null,
      isLoading,
      isSignedIn: !!data,
      error: error
        ? { status: (error as { status?: number }).status, message: (error as Error).message }
        : null,
      refresh,
      signOut,
    }),
    [data, isLoading, error, refresh, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used within <AuthProvider>");
  return ctx;
}
