import { renderContractHtml } from "../src/lib/contract-template.js";
import { htmlToPdf, shutdownPdfRenderer } from "../src/lib/pdf.js";
import fs from "node:fs";

const html = renderContractHtml({
  orgName: "Acme Ltd",
  orgSlug: "acme-plumbing",
  industry: "construction",
  country: "NZ",
  legalEntityName: null,
  planName: "Pro",
  monthlyPriceMinor: 480000,
  currency: "NZD",
  billingCadence: "monthly",
  termMonths: 12,
  startDate: new Date("2026-05-18"),
  customIntegration: true,
  notes: "Microsoft SSO\nNavman Direct",
  signerName: "Simon Acme",
  signerEmail: "redacted@example.com",
  signerTitle: "Director",
  signedAt: new Date("2026-05-18T00:00:00+12:00"),
  signedIp: "34.151.94.155",
  signedUserAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.3.1 Safari/605.1.15",
  contractRef: "dc036d92-3504-4242-8aec-e72b71bae39c",
  generatedAt: new Date(),
});
const pdf = await htmlToPdf(html, { marginMm: { top: 0, right: 0, bottom: 0, left: 0 }, showPageNumbers: false });
fs.writeFileSync("/home/runner/workspace/attached_assets/contract-preview.pdf", pdf);
console.log("Wrote", pdf.length, "bytes");
await shutdownPdfRenderer();
process.exit(0);
