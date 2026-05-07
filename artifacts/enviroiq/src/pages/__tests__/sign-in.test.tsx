import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: null,
    isLoading: false,
    isSignedIn: false,
    sessionError: null,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

const passkeySupportedMock = vi.fn(() => false);

vi.mock("@/lib/webauthn", () => ({
  isPasskeySupported: () => passkeySupportedMock(),
  signInWithPasskey: vi.fn(),
  PasskeyRestrictionError: class PasskeyRestrictionError extends Error {
    code: string;
    source: "user" | "org" | null;
    constructor(message: string, code: string, source: "user" | "org" | null) {
      super(message);
      this.name = "PasskeyRestrictionError";
      this.code = code;
      this.source = source;
    }
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/sign-in", vi.fn()],
}));

import SignInPage from "../sign-in";
import { signInWithPasskey, PasskeyRestrictionError } from "@/lib/webauthn";

function setQuery(search: string) {
  const url = `http://localhost/sign-in${search}`;
  window.history.replaceState({}, "", url);
}

describe("SignInPage restriction callout", () => {
  const originalLocation = window.location.href;

  beforeEach(() => {
    setQuery("");
    passkeySupportedMock.mockReturnValue(false);
    vi.mocked(signInWithPasskey).mockReset();
  });

  afterEach(() => {
    window.history.replaceState({}, "", originalLocation);
  });

  it("renders the restriction callout for sso_method_not_allowed and uses 'your account' wording when source=user", () => {
    setQuery("?error=sso_method_not_allowed&source=user");
    render(<SignInPage />);

    const callout = screen.getByTestId("alert-method-restricted");
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveTextContent("Sign-in method not available");
    expect(callout).toHaveTextContent(/your account/i);
    expect(callout).not.toHaveTextContent(/your organisation/i);

    // The non-restriction inline error banner should NOT also be rendered for
    // a restriction code — the callout fully replaces it.
    expect(
      screen.queryByText(
        /That sign-in method is not enabled for your organisation\./,
      ),
    ).not.toBeInTheDocument();
  });

  it("renders the restriction callout for sso_required_provider_mismatch with 'your organisation' wording when source=org", () => {
    setQuery("?error=sso_required_provider_mismatch&source=org");
    render(<SignInPage />);

    const callout = screen.getByTestId("alert-method-restricted");
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveTextContent("Try a different sign-in method");
    expect(callout).toHaveTextContent(/this organisation requires/i);
    expect(callout).not.toHaveTextContent(/your account is restricted/i);
  });

  it("renders the restriction callout for sso_provider_disabled and falls back to 'your organisation' when source is missing", () => {
    setQuery("?error=sso_provider_disabled");
    render(<SignInPage />);

    const callout = screen.getByTestId("alert-method-restricted");
    expect(callout).toBeInTheDocument();
    expect(callout).toHaveTextContent("That sign-in provider is turned off");
    expect(callout).toHaveTextContent(/disabled for your organisation/i);
  });

  it("does NOT render the restriction callout for non-restriction errors and uses the inline error banner instead", () => {
    setQuery("?error=expired");
    render(<SignInPage />);

    expect(
      screen.queryByTestId("alert-method-restricted"),
    ).not.toBeInTheDocument();

    // The inline error banner copy from the ERRORS map should still appear.
    expect(
      screen.getByText(
        /That sign-in link has expired or already been used\. Request a new one below\./,
      ),
    ).toBeInTheDocument();
  });

  it("does NOT render the restriction callout when there is no error param, but always shows the generic admin-disabled hint", () => {
    setQuery("");
    render(<SignInPage />);

    expect(
      screen.queryByTestId("alert-method-restricted"),
    ).not.toBeInTheDocument();

    const hint = screen.getByTestId("text-method-hint");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent(
      /Some sign-in methods may be disabled by your administrator\./,
    );
  });

  it("uses 'your organisation' wording for sso_method_not_allowed when source=org and still shows the generic admin-disabled hint alongside the callout", () => {
    setQuery("?error=sso_method_not_allowed&source=org");
    render(<SignInPage />);

    const callout = screen.getByTestId("alert-method-restricted");
    expect(callout).toBeInTheDocument();
    // Strict copy contract: org-source must say "your organisation", not
    // "your account". A regression that swapped the source mapping would
    // flip these and pass the looser assertions in earlier tests.
    expect(callout).toHaveTextContent(/your organisation/i);
    expect(callout).not.toHaveTextContent(/your account/i);

    expect(screen.getByTestId("text-method-hint")).toHaveTextContent(
      /Some sign-in methods may be disabled by your administrator\./,
    );
  });

  it("renders the restriction callout with 'your account' wording when signInWithPasskey throws PasskeyRestrictionError(source=user)", async () => {
    passkeySupportedMock.mockReturnValue(true);
    vi.mocked(signInWithPasskey).mockRejectedValueOnce(
      new PasskeyRestrictionError(
        "Sign-in method not available",
        "passkey_method_not_allowed",
        "user",
      ),
    );

    render(<SignInPage />);
    expect(
      screen.queryByTestId("alert-method-restricted"),
    ).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /sign in with a passkey/i }),
    );

    const callout = await screen.findByTestId("alert-method-restricted");
    expect(callout).toHaveTextContent("Sign-in method not available");
    expect(callout).toHaveTextContent(/your account/i);
    expect(callout).not.toHaveTextContent(/your organisation/i);

    // Restriction should NOT also surface in the small inline error banner.
    expect(
      screen.queryByText(/Passkey sign-in failed\./),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Passkey sign-in was cancelled\./),
    ).not.toBeInTheDocument();
  });

  it("renders the restriction callout with 'your organisation' wording when signInWithPasskey throws PasskeyRestrictionError(source=org)", async () => {
    passkeySupportedMock.mockReturnValue(true);
    vi.mocked(signInWithPasskey).mockRejectedValueOnce(
      new PasskeyRestrictionError(
        "Sign-in method not available",
        "passkey_method_not_allowed",
        "org",
      ),
    );

    render(<SignInPage />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /sign in with a passkey/i }),
    );

    const callout = await screen.findByTestId("alert-method-restricted");
    expect(callout).toHaveTextContent(/your organisation/i);
    expect(callout).not.toHaveTextContent(/your account/i);
  });

  it("routes user-cancelled passkey errors (NotAllowedError) to the small inline error banner, not the amber callout", async () => {
    passkeySupportedMock.mockReturnValue(true);
    const notAllowed = new Error("NotAllowedError: The request was cancelled by the user");
    notAllowed.name = "NotAllowedError";
    vi.mocked(signInWithPasskey).mockRejectedValueOnce(notAllowed);

    render(<SignInPage />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: /sign in with a passkey/i }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Passkey sign-in was cancelled\./),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("alert-method-restricted"),
    ).not.toBeInTheDocument();
  });
});
