/**
 * Regression tests for the Account page passkey "Blocked by policy" badge
 * (task #42). The page reads the new `{ passkeys, policy }` envelope from
 * `GET /api/auth/passkeys` and renders an inline amber badge + message on
 * each passkey row when `policy.ok === false`. The wording must match the
 * deciding policy source — "your account" for a per-user override,
 * "your organisation" for an org-wide refusal — so an admin who has
 * narrowed a single user's allow-list gets the right copy.
 *
 * What's mocked:
 *   - `useAuth` returns a signed-in org_viewer so the Account page renders
 *     in "self" mode (no admin viewing-other branch).
 *   - `useToast` is stubbed.
 *   - `wouter`'s `useLocation` so the page can render outside a Router.
 *   - `enrollPasskey` from `@/lib/webauthn` is stubbed to keep the
 *     "Add a Passkey" button inert.
 *   - `useListUsers` from `@workspace/api-client-react` is stubbed — only
 *     consulted in the admin-viewing-other branch we deliberately don't
 *     enter, but we still need it to import cleanly.
 *   - `window.fetch` is stubbed so each test can dial the
 *     `GET /api/auth/passkeys` response policy field independently. The
 *     companion `GET /api/auth/sso/identities` is served as an empty
 *     array so the SSO card renders without complaining.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: {
      userId: "user-1",
      email: "user@example.com",
      name: "Test User",
      role: "org_viewer",
      organisationId: "org-1",
      emailNotificationsEnabled: false,
    },
    isLoading: false,
    isSignedIn: true,
    sessionError: null,
    logout: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/account", vi.fn()],
}));

vi.mock("@/lib/webauthn", () => ({
  enrollPasskey: vi.fn(async () => {}),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListUsers: () => ({ data: { items: [] }, isLoading: false }),
}));

import Account from "../account";

type PolicySource = "user" | "org" | null;

type PasskeysResponse = {
  passkeys: Array<{
    id: string;
    deviceType: string | null;
    backedUp: boolean;
    createdAt: string;
    lastUsedAt: string | null;
    label: string | null;
  }>;
  policy: { ok: boolean; source: PolicySource };
};

const fetchState: { passkeys: PasskeysResponse } = {
  passkeys: {
    passkeys: [
      {
        id: "pk-1",
        deviceType: "singleDevice",
        backedUp: false,
        // Use a recent date so the "Stale" badge never overlaps and confuses
        // the assertions for the "Blocked by policy" badge.
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        label: null,
      },
    ],
    policy: { ok: true, source: null },
  },
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderAccount() {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Account />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchState.passkeys = {
    passkeys: [
      {
        id: "pk-1",
        deviceType: "singleDevice",
        backedUp: false,
        createdAt: new Date().toISOString(),
        lastUsedAt: new Date().toISOString(),
        label: null,
      },
    ],
    policy: { ok: true, source: null },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/auth/passkeys") && !url.match(/\/passkeys\/[^?]/)) {
        return jsonResponse(fetchState.passkeys);
      }
      if (url.includes("/api/auth/sso/identities")) {
        return jsonResponse([]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Account → passkey 'Blocked by policy' badge", () => {
  it("does NOT render the badge or message when policy.ok=true", async () => {
    fetchState.passkeys.policy = { ok: true, source: null };

    renderAccount();

    // Wait until the row has rendered (proves the query has resolved).
    await screen.findByTestId("passkey-pk-1");

    expect(screen.queryByTestId("passkey-blocked-pk-1")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("passkey-blocked-message-pk-1"),
    ).not.toBeInTheDocument();
  });

  it("renders the badge and the 'your organisation' message when policy.ok=false and source='org'", async () => {
    fetchState.passkeys.policy = { ok: false, source: "org" };

    renderAccount();

    const badge = await screen.findByTestId("passkey-blocked-pk-1");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent(/blocked by policy/i);

    const msg = screen.getByTestId("passkey-blocked-message-pk-1");
    expect(msg).toHaveTextContent(/your organisation/i);
    // Strict copy contract: an org-level refusal must NOT use the
    // "your account" wording reserved for per-user overrides.
    expect(msg).not.toHaveTextContent(/your account/i);
  });

  it("renders the badge and the 'your account' message when policy.ok=false and source='user'", async () => {
    fetchState.passkeys.policy = { ok: false, source: "user" };

    renderAccount();

    const badge = await screen.findByTestId("passkey-blocked-pk-1");
    expect(badge).toBeInTheDocument();

    const msg = screen.getByTestId("passkey-blocked-message-pk-1");
    expect(msg).toHaveTextContent(/your account/i);
    expect(msg).not.toHaveTextContent(/your organisation/i);
  });

  it("falls back to the 'your organisation' wording when policy.ok=false but source is null", async () => {
    // Defensive default: the route always sends `source`, but the page
    // fallback (`{ ok: true, source: null }`) plus a future bug that
    // forgot to populate `source` on a refusal must still produce the
    // safer org-level wording rather than incorrectly blaming the user's
    // own account.
    fetchState.passkeys.policy = { ok: false, source: null };

    renderAccount();

    const msg = await screen.findByTestId("passkey-blocked-message-pk-1");
    expect(msg).toHaveTextContent(/your organisation/i);
    expect(msg).not.toHaveTextContent(/your account/i);
  });

  it("renders the badge on every passkey row when there are several and policy.ok=false", async () => {
    // Mirrors the real list view: the badge is rendered per-row, not just
    // on the first one. A regression that scoped the conditional to a
    // single row would surface here.
    fetchState.passkeys = {
      passkeys: [
        {
          id: "pk-1",
          deviceType: "singleDevice",
          backedUp: false,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          label: "MacBook",
        },
        {
          id: "pk-2",
          deviceType: "multiDevice",
          backedUp: true,
          createdAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
          label: "iPhone",
        },
      ],
      policy: { ok: false, source: "org" },
    };

    renderAccount();

    await waitFor(() => {
      expect(screen.getByTestId("passkey-blocked-pk-1")).toBeInTheDocument();
      expect(screen.getByTestId("passkey-blocked-pk-2")).toBeInTheDocument();
    });
    expect(
      screen.getByTestId("passkey-blocked-message-pk-1"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("passkey-blocked-message-pk-2"),
    ).toBeInTheDocument();
  });
});
