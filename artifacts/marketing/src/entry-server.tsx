import { renderToString } from "react-dom/server";
import App from "./App";

/**
 * Server-side render for build-time prerendering.
 * Returns the HTML string to be inserted inside <div id="root">.
 *
 * The outer wrapper carries `data-prerendered` so the client bundle
 * knows to hydrate instead of re-mounting.
 */
export function render(url: string): string {
  const html = renderToString(<App ssrPath={url} />);
  return `<div data-prerendered="true">${html}</div>`;
}

export const ROUTES = ["/", "/trust", "/terms", "/license"] as const;

export const ROUTE_META: Record<
  string,
  { title: string; description: string; canonical: string }
> = {
  "/": {
    title:
      "EnviroIQ — Real-Time ESG Intelligence for New Zealand Organisations",
    description:
      "Audit-grade ESG data your board, auditor, and regulator will actually trust. Real-time emissions, full E+S+G coverage, immutable audit log, AI ESG Advisor, NZ em6 grid data, supplier audits, CRM integration API.",
    canonical: "https://enviroiq.net/",
  },
  "/trust": {
    title: "Trust & Compliance — EnviroIQ",
    description:
      "Every ESG number, fully traceable from source to output. Live operational compliance status, downloadable trust pack, immutable audit log, versioned emission factors, passwordless authentication. SOC 2, ISO 27001, NZ Privacy Act, GDPR aligned.",
    canonical: "https://enviroiq.net/trust",
  },
  "/terms": {
    title: "Terms and Conditions — EnviroIQ",
    description:
      "EnviroIQ Terms and Conditions. Subscription, fees, cancellation (3 months' notice standard, 12 months or 80% Early Termination Charge where Custom Integration has been delivered), data ownership, liability and governing law (New Zealand).",
    canonical: "https://enviroiq.net/terms",
  },
  "/license": {
    title: "Software Licence Agreement — EnviroIQ",
    description:
      "EnviroIQ Software Licence Agreement. Licence grant, restrictions, ownership, Customer Data licence, API and integration use, suspension, termination and governing law (New Zealand).",
    canonical: "https://enviroiq.net/license",
  },
};
