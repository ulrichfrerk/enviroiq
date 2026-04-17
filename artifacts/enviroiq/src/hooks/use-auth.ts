import { useQueryClient } from "@tanstack/react-query";
import { useClerk, useUser } from "@clerk/react";
import { useGetSession, getGetSessionQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";

/**
 * Combined auth hook.
 *
 * - Reads the Clerk-authenticated user via `useUser()` for sign-in state.
 * - Calls the backend `/auth/session` endpoint via `useGetSession()` so the
 *   UI gets the local org/role context (organisationId, role, name) that
 *   Clerk does not store.
 * - Provides a `logout()` that signs out of Clerk and clears the local query
 *   cache so the next render does not show stale tenant data.
 */
export function useAuth() {
  const { isSignedIn, isLoaded: isClerkLoaded } = useUser();
  const {
    data: session,
    isLoading: isSessionLoading,
    error: sessionError,
  } = useGetSession({
    query: { enabled: isSignedIn === true, retry: false },
  });
  const queryClient = useQueryClient();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();

  const logout = async () => {
    try {
      await signOut();
    } finally {
      queryClient.setQueryData(getGetSessionQueryKey(), null);
      queryClient.removeQueries({ queryKey: getGetSessionQueryKey() });
      setLocation("/sign-in");
    }
  };

  return {
    session,
    isLoading: !isClerkLoaded || (isSignedIn && isSessionLoading),
    isSignedIn,
    sessionError: sessionError as unknown as { status?: number; message?: string } | null,
    logout,
  };
}
