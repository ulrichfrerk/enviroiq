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

type WebAuthnCredentialResponse = {
  id: string;
  rawId: string;
  type: string;
  response: {
    attestationObject?: string;
    clientDataJSON: string;
    authenticatorData?: string;
    signature?: string;
    userHandle?: string;
  };
  [key: string]: unknown;
}

interface ParsedPublicKeyOptions {
  challenge: ArrayBuffer;
  allowCredentials?: Array<{ id: ArrayBuffer; type: string; transports?: string[] }>;
  [key: string]: unknown;
}

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
      const publicKey: PublicKeyCredentialCreationOptions = {
        ...(options as object),
        challenge: bufferDecode(options.challenge),
        user: {
          ...(options.user as object),
          id: bufferDecode(options.user.id),
        },
        attestation: (options.attestation ?? "none") as AttestationConveyancePreference,
      } as PublicKeyCredentialCreationOptions;

      // 3. Create credential
      const credential = await navigator.credentials.create({ publicKey }) as PublicKeyCredential;

      // 4. Format response
      const attResp = credential.response as AuthenticatorAttestationResponse;
      const credentialResponse: WebAuthnCredentialResponse = {
        id: credential.id,
        rawId: bufferEncode(credential.rawId),
        type: credential.type,
        response: {
          attestationObject: bufferEncode(attResp.attestationObject),
          clientDataJSON: bufferEncode(attResp.clientDataJSON),
        },
      };

      // 5. Complete registration
      await completeReg.mutateAsync({
        data: {
          credential: credentialResponse,
          email,
          name
        }
      });

      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      toast({ title: "Registration successful", description: "Your passkey has been set up." });
      setLocation("/dashboard");
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Could not set up passkey.";
      toast({ variant: "destructive", title: "Registration failed", description: message });
    }
  };

  const loginPasskey = async (email?: string) => {
    try {
      // 1. Begin auth
      const options = await beginAuth.mutateAsync({ data: { email } });

      // 2. Format options
      const parsedOptions: ParsedPublicKeyOptions = {
        ...(options as object),
        challenge: bufferDecode(options.challenge),
      };

      if (options.allowCredentials) {
        parsedOptions.allowCredentials = (options.allowCredentials as Array<{ id: string; type: string; transports?: string[] }>).map((c) => ({
          ...c,
          id: bufferDecode(c.id),
        }));
      }

      // 3. Get credential
      const credential = await navigator.credentials.get({ publicKey: parsedOptions as PublicKeyCredentialRequestOptions }) as PublicKeyCredential;

      // 4. Format response
      const assertResp = credential.response as AuthenticatorAssertionResponse;
      const credentialResponse: WebAuthnCredentialResponse = {
        id: credential.id,
        rawId: bufferEncode(credential.rawId),
        type: credential.type,
        response: {
          authenticatorData: bufferEncode(assertResp.authenticatorData),
          clientDataJSON: bufferEncode(assertResp.clientDataJSON),
          signature: bufferEncode(assertResp.signature),
          userHandle: assertResp.userHandle ? bufferEncode(assertResp.userHandle) : undefined,
        },
      };

      // 5. Complete auth
      await completeAuth.mutateAsync({ data: { credential: credentialResponse } });

      queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      toast({ title: "Welcome back", description: "Successfully logged in." });
      setLocation("/dashboard");
    } catch (err: unknown) {
      console.error(err);
      const message = err instanceof Error ? err.message : "Could not authenticate passkey.";
      toast({ variant: "destructive", title: "Login failed", description: message });
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
