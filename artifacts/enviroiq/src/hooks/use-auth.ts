import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import {
  useGetSession,
  useBeginPasskeyRegistration,
  useCompletePasskeyRegistration,
  useBeginPasskeyAuthentication,
  useCompletePasskeyAuthentication,
  useLogout,
  getGetSessionQueryKey
} from "@workspace/api-client-react";
import { bufferDecode, bufferEncode } from "@/lib/webauthn";
import { useLocation } from "wouter";

export function useAuth() {
  const { data: session, isLoading } = useGetSession();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const beginReg = useBeginPasskeyRegistration();
  const completeReg = useCompletePasskeyRegistration();
  const beginAuth = useBeginPasskeyAuthentication();
  const completeAuth = useCompletePasskeyAuthentication();
  const logoutMut = useLogout();

  const registerPasskey = async (email: string, name: string) => {
    try {
      // 1. Begin registration
      const options = await beginReg.mutateAsync({ data: { email, name } });

      // 2. Format options for browser
      const publicKey = {
        ...options,
        challenge: bufferDecode(options.challenge),
        user: {
          ...options.user,
          id: bufferDecode(options.user.id),
        },
      };

      // 3. Create credential
      const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;

      // 4. Format response
      const credentialResponse = {
        id: credential.id,
        rawId: bufferEncode(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: bufferEncode((credential.response as AuthenticatorAttestationResponse).attestationObject),
          clientDataJSON: bufferEncode(credential.response.clientDataJSON),
        },
      };

      // 5. Complete registration
      await completeReg.mutateAsync({ 
        data: { 
          credential: credentialResponse as any, 
          email,
          name
        } 
      });

      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      toast({ title: "Registration successful", description: "Your passkey has been set up." });
      setLocation("/dashboard");
    } catch (err: any) {
      console.error(err);
      toast({ variant: "destructive", title: "Registration failed", description: err.message || "Could not set up passkey." });
    }
  };

  const loginPasskey = async (email?: string) => {
    try {
      // 1. Begin auth
      const options = await beginAuth.mutateAsync({ data: { email } });

      // 2. Format options
      const publicKey: any = {
        ...options,
        challenge: bufferDecode(options.challenge),
      };

      if (options.allowCredentials) {
        publicKey.allowCredentials = options.allowCredentials.map((c: any) => ({
          ...c,
          id: bufferDecode(c.id),
        }));
      }

      // 3. Get credential
      const credential = await navigator.credentials.get({ publicKey }) as PublicKeyCredential;

      // 4. Format response
      const credentialResponse = {
        id: credential.id,
        rawId: bufferEncode(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bufferEncode((credential.response as AuthenticatorAssertionResponse).authenticatorData),
          clientDataJSON: bufferEncode(credential.response.clientDataJSON),
          signature: bufferEncode((credential.response as AuthenticatorAssertionResponse).signature),
          userHandle: (credential.response as AuthenticatorAssertionResponse).userHandle 
            ? bufferEncode((credential.response as AuthenticatorAssertionResponse).userHandle!) 
            : undefined,
        },
      };

      // 5. Complete auth
      await completeAuth.mutateAsync({ data: { credential: credentialResponse as any } });

      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      toast({ title: "Welcome back", description: "Successfully logged in." });
      setLocation("/dashboard");
    } catch (err: any) {
      console.error(err);
      toast({ variant: "destructive", title: "Login failed", description: err.message || "Could not authenticate passkey." });
    }
  };

  const logout = async () => {
    await logoutMut.mutateAsync();
    queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
    setLocation("/login");
  };

  return {
    session,
    isLoading,
    registerPasskey,
    loginPasskey,
    logout,
    isRegistering: beginReg.isPending || completeReg.isPending,
    isAuthenticating: beginAuth.isPending || completeAuth.isPending,
  };
}
