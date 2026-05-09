/**
 * Regression tests for the Settings → Sign-in & SSO history block, exposed
 * by the page via `data-testid="sso-policy-history"`.
 *
 * Why these tests exist:
 *   The history list is the admin's first stop when answering "why is
 *   everyone in our org suddenly restricted?". We want to lock down two
 *   guarantees beyond the API-side coverage:
 *     1. The history block renders for an admin (not gated off behind a
 *        loading spinner that never resolves, not accidentally hidden by
 *        the `enabled: isAdmin` query flag).
 *     2. After an admin saves a real policy change via PATCH, the new
 *        entry appears in the history block — i.e. the list is invalidated
 *        and refetched as soon as the mutation succeeds.
 *
 * What's mocked:
 *   - `useAuth` returns an org_admin session.
 *   - `@workspace/api-client-react`'s data hooks (energy email, widget
 *     config) — not under test here, just need to return non-loading.
 *   - `wouter`'s `useLocation` so the Settings page can render outside a
 *     Router.
 *   - `window.fetch` is stubbed with a tiny in-memory router that serves
 *     the four endpoints SsoPolicyCard touches:
 *         GET   /api/organisations/:orgId/sso-policy
 *         GET   /api/organisations/:orgId/sso-policy/history
 *         PATCH /api/organisations/:orgId/sso-policy
 *         GET   /api/organisations/:orgId/webhook-credentials
 *     A successful PATCH appends a new history row so the post-save
 *     refetch can prove the UI re-renders the timeline with the new entry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    session: {
      userId: "admin-1",
      email: "admin@example.com",
      name: "Admin",
      role: "org_admin",
      organisationId: "org-1",
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
  useLocation: () => ["/settings", vi.fn()],
}));

// The Settings page also pulls a couple of unrelated data hooks. They are
// out of scope for this suite — return shapes that let the page render.
vi.mock("@workspace/api-client-react", () => ({
  useGetEnergyEmailAddress: () => ({
    data: { emailAddress: "inbox-org-1@enviroiq.example" },
    isLoading: false,
  }),
  useGetWidgetConfig: () => ({
    data: { widgetKey: "widget-key-abc" },
    isLoading: false,
  }),
}));

import Settings from "../settings";

// ─── Fetch router ───────────────────────────────────────────────────────────

type SsoPolicy = {
  googleSsoEnabled: boolean;
  microsoftSsoEnabled: boolean;
  allowedSignInMethods: string[];
  requiredSsoProvider: "google" | "microsoft" | null;
};

type HistoryEntry = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorType: string | null;
  previousValue: Partial<SsoPolicy> | null;
  newValue: Partial<SsoPolicy> | null;
};

const fetchState: {
  policy: SsoPolicy;
  history: HistoryEntry[];
  patchCalls: SsoPolicy[];
} = {
  policy: {
    googleSsoEnabled: true,
    microsoftSsoEnabled: true,
    allowedSignInMethods: ["magic_link", "passkey", "google_sso", "microsoft_sso"],
    requiredSsoProvider: null,
  },
  history: [],
  patchCalls: [],
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function makeQueryClient() {
  // Disable retries so a missing mock surfaces as an immediate failure
  // rather than a 5-attempt 30s hang.
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderSettings() {
  const qc = makeQueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fetchState.policy = {
    googleSsoEnabled: true,
    microsoftSsoEnabled: true,
    allowedSignInMethods: ["magic_link", "passkey", "google_sso", "microsoft_sso"],
    requiredSsoProvider: null,
  };
  fetchState.history = [
    {
      id: "row-existing-1",
      createdAt: "2026-04-01T10:00:00.000Z",
      actorUserId: "admin-1",
      actorEmail: "earlier-admin@example.com",
      actorType: "user",
      previousValue: { requiredSsoProvider: null },
      newValue: { requiredSsoProvider: null },
    },
  ];
  fetchState.patchCalls = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/api/organisations/org-1/sso-policy") && method === "GET") {
        return jsonResponse(fetchState.policy);
      }
      if (url.endsWith("/api/organisations/org-1/sso-policy/history") && method === "GET") {
        return jsonResponse({ items: fetchState.history });
      }
      if (url.endsWith("/api/organisations/org-1/sso-policy") && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as SsoPolicy;
        fetchState.patchCalls.push(body);
        const previous = { ...fetchState.policy };
        fetchState.policy = body;
        // Server-side: every successful PATCH writes a new history row.
        // Prepend so DESC-by-createdAt ordering is preserved for the
        // re-fetch.
        fetchState.history = [
          {
            id: `row-new-${fetchState.patchCalls.length}`,
            createdAt: new Date().toISOString(),
            actorUserId: "admin-1",
            actorEmail: "admin@example.com",
            actorType: "user",
            previousValue: previous,
            newValue: body,
          },
          ...fetchState.history,
        ];
        return jsonResponse(body);
      }
      if (url.includes("/webhook-credentials")) {
        return jsonResponse({
          webhookSecret: "secret-abc",
          fleetWebhookUrl: "/webhooks/fleet",
          energyWebhookUrl: "/webhooks/energy",
        });
      }
      // Anything else is unexpected — fail loudly.
      throw new Error(`Unexpected fetch ${method} ${url}`);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Tests ──────────────────────────────────────────────────────────────────
describe("Settings → Sign-in & SSO history", () => {
  it("renders the history section for an org admin and shows the existing entry", async () => {
    renderSettings();

    const block = await screen.findByTestId("sso-policy-history");
    expect(block).toBeInTheDocument();

    // The pre-seeded entry should be rendered (proves the block isn't
    // stuck on the loading spinner and the actor's email is surfaced).
    await waitFor(() => {
      expect(
        screen.getByTestId("sso-policy-history-entry-row-existing-1"),
      ).toBeInTheDocument();
    });
    expect(within(block).getByText(/earlier-admin@example.com/)).toBeInTheDocument();

    // The "no changes recorded yet" empty-state copy must NOT also show.
    expect(
      within(block).queryByText(/no org-wide sign-in policy changes recorded yet/i),
    ).not.toBeInTheDocument();
  });

  it("shows a new entry in the history block immediately after the admin saves a real policy change", async () => {
    renderSettings();

    // Wait for the policy to load and the Save button to be in the DOM.
    const saveBtn = await screen.findByTestId("button-save-sso-policy");

    // Initially no patch has been issued and no "row-new-1" entry exists.
    expect(fetchState.patchCalls).toHaveLength(0);
    expect(
      screen.queryByTestId("sso-policy-history-entry-row-new-1"),
    ).not.toBeInTheDocument();

    // Make a real change: turn off Google SSO. This dirties the form so
    // the Save button enables.
    const user = userEvent.setup();
    await user.click(screen.getByTestId("checkbox-google-sso-enabled"));

    await waitFor(() => expect(saveBtn).not.toBeDisabled());
    await user.click(saveBtn);

    // The PATCH was issued with googleSsoEnabled=false…
    await waitFor(() => expect(fetchState.patchCalls).toHaveLength(1));
    expect(fetchState.patchCalls[0].googleSsoEnabled).toBe(false);

    // …and the history list re-rendered with the new server-side row.
    const newEntry = await screen.findByTestId("sso-policy-history-entry-row-new-1");
    expect(newEntry).toBeInTheDocument();
    // The diff line for "Google off" should appear in the new entry.
    expect(within(newEntry).getByText(/Google on → Google off/)).toBeInTheDocument();
  });
});
