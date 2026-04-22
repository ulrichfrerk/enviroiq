import { useAuthContext } from "@/providers/auth-provider";

/**
 * Combined auth hook — backed by our custom session cookie + /api/auth/session.
 *
 * Returns:
 *  - session   : the user record (or null) — kept under `session` for back-compat
 *                with the legacy Clerk-era hook callers across the codebase.
 *  - isLoading : true while the initial /auth/session request is in flight
 *  - isSignedIn: true when the session resolved with a user
 *  - sessionError: shape preserved from the legacy hook (status + message)
 *  - logout()  : POST /auth/logout, clear caches, redirect to /sign-in
 */
export function useAuth() {
  const { user, isLoading, isSignedIn, error, signOut, refresh } = useAuthContext();

  return {
    session: user,
    isLoading,
    isSignedIn,
    sessionError: error,
    logout: signOut,
    refresh,
  };
}
