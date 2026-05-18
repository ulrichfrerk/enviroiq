/**
 * Contract / Order Form PDF template.
 *
 * Renders the EnviroIQ master terms + a customer-specific Order Form cover page
 * showing pricing, term, signer details and acceptance metadata. Designed to be
 * printed to PDF via the shared puppeteer wrapper in ./pdf.ts.
 *
 * The legal clauses below are kept in lock-step with
 * artifacts/marketing/src/pages/terms.tsx (version 1.0, 5 May 2026). When the
 * marketing terms change, bump CONTRACT_TERMS_VERSION below and update the
 * clauses in both files.
 */

export const CONTRACT_TERMS_VERSION = "1.0";
export const CONTRACT_TERMS_LAST_UPDATED = "5 May 2026";

export type ContractRenderInput = {
  /** Customer organisation. */
  orgName: string;
  orgSlug: string;
  industry?: string | null;
  country?: string | null;
  legalEntityName?: string | null;

  /** Commercials. */
  planName: string;
  monthlyPriceMinor: number; // store as smallest whole-cent unit to avoid float
  currency: string; // ISO 4217, e.g. "NZD"
  billingCadence: "monthly" | "annual";
  termMonths: number;
  startDate: Date;
  customIntegration: boolean;
  notes?: string | null;

  /** Acceptance metadata. */
  signerName: string;
  signerEmail: string;
  signerTitle?: string | null;
  signedAt: Date;
  signedIp?: string | null;
  signedUserAgent?: string | null;

  /** Audit. */
  contractRef: string; // e.g. subscription id
  generatedAt: Date;
};

function fmtMoney(amountMinor: number, currency: string): string {
  const major = amountMinor / 100;
  try {
    return new Intl.NumberFormat("en-NZ", { style: "currency", currency }).format(major);
  } catch {
    return `${currency} ${major.toFixed(2)}`;
  }
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-NZ", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("en-NZ", { dateStyle: "long", timeStyle: "short", timeZone: "Pacific/Auckland" }) + " NZT";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]!));
}

function calcContractValue(input: ContractRenderInput): {
  monthlyDisplay: string;
  periodDisplay: string;
  totalDisplay: string;
} {
  const monthly = input.monthlyPriceMinor;
  const total = monthly * input.termMonths;
  const periodAmount = input.billingCadence === "annual" ? monthly * 12 : monthly;
  return {
    monthlyDisplay: fmtMoney(monthly, input.currency),
    periodDisplay: fmtMoney(periodAmount, input.currency) + (input.billingCadence === "annual" ? " / year" : " / month"),
    totalDisplay: fmtMoney(total, input.currency),
  };
}

/**
 * The clauses, mirrored from the public Terms page.
 *
 * Kept as plain HTML strings (no React) so they can render server-side without
 * any JSX runtime. Cancellation clause 6 is intentionally verbose because it
 * carries the commercial teeth.
 */
const CLAUSES: { id: string; title: string; html: string }[] = [
  {
    id: "1-parties",
    title: "1. Parties and acceptance",
    html: `
      <p>These Terms and Conditions ("Terms") form a binding agreement between
        <strong>Frerken Companies Limited</strong>, a New Zealand company trading as
        <strong>EnviroIQ</strong> ("EnviroIQ", "we", "us", "our"), and the
        organisation that subscribes to the EnviroIQ platform ("Customer", "you", "your").</p>
      <p>By signing an Order Form, accepting an electronic quote, clicking "I agree", or
        accessing or using the EnviroIQ platform ("Service"), you confirm that you have
        authority to bind the Customer and that the Customer accepts these Terms.</p>
    `,
  },
  {
    id: "2-definitions",
    title: "2. Definitions",
    html: `
      <ul>
        <li><strong>Order Form</strong> means a written or electronic order, quote, proposal or statement of work signed or accepted by both parties that references these Terms.</li>
        <li><strong>Subscription Term</strong> means the period of paid access to the Service set out in the Order Form (and any renewals).</li>
        <li><strong>Customer Data</strong> means data submitted to the Service by or on behalf of the Customer, including emissions, fleet, energy, supplier and operational data.</li>
        <li><strong>Custom Integration</strong> means any bespoke integration, connector, data pipeline, API, embedded widget, white-labelled deployment, or engineering work scoped specifically for the Customer and recorded in an Order Form or Statement of Work.</li>
        <li><strong>Fees</strong> means the subscription, integration, professional services and other charges set out in the Order Form.</li>
      </ul>
    `,
  },
  {
    id: "3-service",
    title: "3. The Service",
    html: `
      <p>EnviroIQ grants the Customer a non-exclusive, non-transferable, non-sublicensable
        right to access and use the Service during the Subscription Term, for the
        Customer's internal business operations and for the number of users specified in
        the Order Form, subject to these Terms and the Software Licence Agreement
        published at enviroiq.net/license.</p>
      <p>We may improve, modify, add to or remove features at any time. We will not
        materially reduce the core functionality the Customer is paying for during a
        paid Subscription Term without reasonable notice.</p>
    `,
  },
  {
    id: "4-fees",
    title: "4. Fees and payment",
    html: `
      <p>The Customer must pay the Fees set out in the Order Form. Unless the Order Form
        says otherwise:</p>
      <ul>
        <li>Subscription Fees are invoiced monthly or annually in advance.</li>
        <li>Custom Integration and professional services Fees are invoiced 50% on commencement and 50% on delivery, unless an alternative milestone schedule is agreed.</li>
        <li>All Fees are exclusive of GST and any other applicable taxes, which the Customer must pay in addition.</li>
        <li>Invoices are payable within <strong>14 days</strong> of the invoice date.</li>
        <li>Overdue amounts accrue interest at 1.5% per month (or the maximum rate permitted by law, whichever is lower) and the Customer must reimburse reasonable collection costs.</li>
      </ul>
      <p>We may adjust Subscription Fees at the start of any renewal term by giving at
        least 30 days' written notice. Fees are not adjusted mid-term except where
        additional users, modules or volume tiers are added.</p>
    `,
  },
  {
    id: "5-term",
    title: "5. Term and renewal",
    html: `
      <p>These Terms commence on the date the first Order Form is accepted and continue
        until terminated in accordance with these Terms. Each Order Form has its own
        Subscription Term as stated in that Order Form. Unless either party gives notice
        of non-renewal in accordance with clause 6, each Subscription Term automatically
        renews for successive periods equal to the initial Subscription Term.</p>
    `,
  },
  {
    id: "6-cancellation",
    title: "6. Cancellation and notice periods",
    html: `
      <div class="callout callout-primary">
        <p class="callout-title">Standard subscriptions — 3 months' notice</p>
        <p>Either party may cancel the Service by giving the other party at least
          <strong>three (3) months' written notice</strong>. The notice period runs from
          the first day of the calendar month following receipt of the notice. Fees
          remain payable in full for the entire notice period regardless of whether the
          Customer continues to use the Service.</p>
      </div>
      <div class="callout callout-warning">
        <p class="callout-title">Where Custom Integration has been delivered — 12 months' notice <em>or</em> Early Termination Charge</p>
        <p>Where EnviroIQ has performed any Custom Integration for the Customer (including
          any bespoke connector, data pipeline, embedded widget, white-labelled
          deployment, or engineering work scoped to the Customer), the Customer may
          cancel the Service only by either:</p>
        <ul>
          <li>giving at least <strong>twelve (12) months' written notice</strong>, with Fees payable in full for the entire notice period; <strong>or</strong></li>
          <li>paying an <strong>Early Termination Charge equal to eighty percent (80%) of the remaining contract value</strong> (calculated as the total Subscription Fees that would have been payable for the unexpired portion of the then-current Subscription Term and any signed renewal, exclusive of GST). The Early Termination Charge is due in a single payment on the date of cancellation.</li>
        </ul>
        <p class="muted">The Customer chooses which option to take by stating it in the cancellation notice. If no option is stated, the 12-month notice period applies by default.</p>
      </div>
      <p>The cancellation provisions in this clause 6 reflect that Custom Integration
        work involves up-front engineering investment by EnviroIQ that is amortised over
        the expected life of the engagement, and that EnviroIQ would not perform Custom
        Integration on the same commercial terms absent this commitment.</p>
      <p>Cancellation does not relieve the Customer of any Fees accrued before the
        effective date of cancellation, and EnviroIQ is not required to refund any
        prepaid Fees on cancellation by the Customer.</p>
    `,
  },
  {
    id: "7-termination",
    title: "7. Termination for cause",
    html: `
      <p>Either party may terminate these Terms (and any Order Form) immediately by written notice if:</p>
      <ul>
        <li>the other party commits a material breach that is not remedied within 14 days of written notice; or</li>
        <li>the other party becomes insolvent, has a receiver, liquidator, statutory manager, voluntary administrator or similar appointed, ceases to carry on business, or is unable to pay its debts as they fall due.</li>
      </ul>
      <p>EnviroIQ may also suspend or terminate the Service immediately on written notice
        if the Customer fails to pay any undisputed invoice within 14 days of the due
        date, or where continued provision of the Service would expose EnviroIQ to legal
        or regulatory risk.</p>
      <p>Where the Customer terminates for EnviroIQ's uncured material breach, the
        Customer is entitled to a pro-rata refund of prepaid Subscription Fees for the
        unused portion of the then-current Subscription Term, and the cancellation
        notice and Early Termination Charge provisions in clause 6 do not apply.</p>
    `,
  },
  {
    id: "8-customer-data",
    title: "8. Customer Data",
    html: `
      <p>As between the parties, the Customer owns all Customer Data. The Customer grants
        EnviroIQ a non-exclusive, royalty-free licence to host, copy, transmit, process,
        analyse, display and otherwise use Customer Data solely to provide and improve
        the Service, to produce de-identified and aggregated analytics, and to comply
        with law.</p>
      <p>The Customer is responsible for the accuracy, quality and legality of Customer
        Data, for obtaining all necessary consents, and for ensuring its use of the
        Service complies with applicable law (including the Privacy Act 2020).</p>
      <p>On request following termination, EnviroIQ will provide the Customer a one-time
        export of Customer Data in a commonly used machine-readable format. Thirty (30)
        days after termination EnviroIQ may delete Customer Data from production
        systems; backups are purged on a rolling basis in line with EnviroIQ's standard
        retention schedule.</p>
    `,
  },
  {
    id: "9-acceptable-use",
    title: "9. Acceptable use",
    html: `
      <p>The Customer must not, and must not allow any user to:</p>
      <ul>
        <li>use the Service in breach of any law, regulation or third-party right;</li>
        <li>upload data containing malicious code or attempt to interfere with the Service's security or integrity;</li>
        <li>resell, rent, sublicense or make the Service available to any third party except as expressly permitted under an Order Form;</li>
        <li>reverse-engineer, decompile or disassemble the Service, or attempt to derive its source code, except to the extent the law expressly permits;</li>
        <li>use the Service to build a competing product, or benchmark it for the purpose of publication without EnviroIQ's prior written consent.</li>
      </ul>
    `,
  },
  {
    id: "10-ip",
    title: "10. Intellectual property",
    html: `
      <p>EnviroIQ (and its licensors) own all intellectual property rights in the Service,
        including all software, methodologies, emission factor catalogues, calculation
        engines, dashboards, documentation, and any improvements, derivatives or
        feedback-based changes.</p>
      <p>Where EnviroIQ delivers Custom Integration work, EnviroIQ retains ownership of
        all underlying frameworks, libraries, tooling and platform code; the Customer
        receives a perpetual, non-exclusive licence to use the Custom Integration solely
        in connection with its use of the Service.</p>
    `,
  },
  {
    id: "11-confidentiality",
    title: "11. Confidentiality",
    html: `
      <p>Each party will keep confidential any non-public information of the other party
        that is identified as confidential or that a reasonable person would understand
        to be confidential, and use it only to perform its obligations or exercise its
        rights under these Terms.</p>
    `,
  },
  {
    id: "12-warranties",
    title: "12. Warranties and disclaimers",
    html: `
      <p>EnviroIQ warrants that it will provide the Service with reasonable care and
        skill. Except as expressly stated, the Service is provided "as is" and EnviroIQ
        excludes, to the fullest extent permitted by law, all other warranties whether
        express, implied or statutory.</p>
      <p>The Customer acknowledges that the Service produces estimates, calculations and
        dashboards based on the data and methodologies available, and that the Customer
        is responsible for reviewing the outputs before relying on them for regulatory,
        board or audit purposes.</p>
    `,
  },
  {
    id: "13-liability",
    title: "13. Limitation of liability",
    html: `
      <p>To the fullest extent permitted by law, neither party is liable to the other for
        any loss of profit, loss of revenue, loss of business, loss of anticipated
        savings, loss of goodwill or for any indirect, special, incidental,
        consequential or punitive damages.</p>
      <p>Each party's total aggregate liability arising out of or in connection with
        these Terms in any 12-month period is limited to the Fees paid by the Customer
        to EnviroIQ in the 12 months preceding the event giving rise to the claim.</p>
    `,
  },
  {
    id: "14-indemnity",
    title: "14. Indemnity",
    html: `
      <p>The Customer indemnifies EnviroIQ against all losses, damages, claims and costs
        (including reasonable legal costs) arising from (a) Customer Data, (b) the
        Customer's breach of clause 9 (Acceptable use), or (c) the Customer's misuse of
        the outputs of the Service in a way that breaches law or third-party rights.</p>
    `,
  },
  {
    id: "15-force-majeure",
    title: "15. Force majeure",
    html: `
      <p>Neither party is liable for any failure or delay in performance (other than an
        obligation to pay money) caused by an event outside its reasonable control.</p>
    `,
  },
  {
    id: "16-general",
    title: "16. General",
    html: `
      <ul>
        <li><strong>Entire agreement:</strong> these Terms together with each Order Form and the Software Licence Agreement form the entire agreement between the parties on the subject matter.</li>
        <li><strong>Order of precedence:</strong> if there is a conflict, the Order Form prevails over these Terms, and these Terms prevail over the Software Licence Agreement.</li>
        <li><strong>Assignment:</strong> the Customer may not assign these Terms without EnviroIQ's prior written consent. EnviroIQ may assign on notice in connection with a sale of business, merger or restructure.</li>
        <li><strong>Notices:</strong> notices must be in writing and sent by email to the contact addresses recorded in the Order Form. Notices to EnviroIQ must be copied to contact@frerkencompanies.com.</li>
        <li><strong>Governing law:</strong> these Terms are governed by the laws of New Zealand. The parties submit to the exclusive jurisdiction of the New Zealand courts.</li>
      </ul>
    `,
  },
];

export function renderContractHtml(input: ContractRenderInput): string {
  const v = calcContractValue(input);
  const endDate = new Date(input.startDate);
  endDate.setMonth(endDate.getMonth() + input.termMonths);

  const partyName = esc(input.legalEntityName?.trim() || input.orgName);
  const tradingName = input.legalEntityName && input.legalEntityName.trim() !== input.orgName
    ? `<div class="party-trading">trading as ${esc(input.orgName)}</div>`
    : "";

  const clausesHtml = CLAUSES.map(
    (c) => `<section class="clause"><h2>${esc(c.title)}</h2>${c.html}</section>`,
  ).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>EnviroIQ Order Form &amp; Master Agreement — ${partyName}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  :root {
    --fg: #0f172a;
    --muted: #475569;
    --line: #e2e8f0;
    --accent: #0ea5e9;
    --warn: #d97706;
    --warn-bg: #fff7ed;
    --accent-bg: #ecfeff;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: "Helvetica Neue", Inter, Arial, sans-serif; color: var(--fg); font-size: 10.5pt; line-height: 1.55; }

  /* Cover / Order Form */
  .cover { padding: 0 0 18mm; }
  .cover-head { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 6mm; border-bottom: 2px solid var(--fg); }
  .brand { font-size: 18pt; font-weight: 700; letter-spacing: -0.01em; }
  .brand-sub { font-size: 9pt; color: var(--muted); margin-top: 2px; }
  .doc-meta { text-align: right; font-size: 9pt; color: var(--muted); }
  .doc-meta .ref { font-family: "SFMono-Regular", Menlo, Consolas, monospace; color: var(--fg); }

  h1.cover-title { font-size: 20pt; font-weight: 700; margin: 8mm 0 2mm; letter-spacing: -0.01em; }
  .cover-sub { color: var(--muted); margin: 0 0 6mm; }

  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; margin-top: 6mm; }
  .party { border: 1px solid var(--line); border-radius: 6px; padding: 5mm; }
  .party h3 { margin: 0 0 2mm; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
  .party-name { font-size: 12pt; font-weight: 600; }
  .party-trading { color: var(--muted); font-size: 9.5pt; margin-top: 1mm; }
  .party-meta { margin-top: 3mm; font-size: 9.5pt; color: var(--muted); line-height: 1.6; }

  .order-table { width: 100%; border-collapse: collapse; margin-top: 6mm; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .order-table th, .order-table td { padding: 3mm 4mm; text-align: left; font-size: 10pt; border-bottom: 1px solid var(--line); }
  .order-table th { background: #f8fafc; font-weight: 600; width: 38%; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; font-size: 8.5pt; }
  .order-table tr:last-child th, .order-table tr:last-child td { border-bottom: none; }
  .order-total td, .order-total th { background: #f1f5f9; font-weight: 700; }
  .price-big { font-size: 13pt; font-weight: 700; }

  .accept-box { margin-top: 8mm; border: 2px solid var(--fg); border-radius: 6px; padding: 6mm; background: #fafafa; }
  .accept-box h3 { margin: 0 0 3mm; font-size: 11pt; }
  .accept-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm 6mm; font-size: 10pt; }
  .accept-grid div { display: flex; flex-direction: column; }
  .accept-grid .label { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; margin-bottom: 1mm; }
  .accept-grid .value { font-weight: 600; }
  .accept-grid .value.mono { font-family: "SFMono-Regular", Menlo, Consolas, monospace; font-weight: 500; font-size: 9pt; word-break: break-all; }
  .accept-note { margin-top: 4mm; font-size: 8.5pt; color: var(--muted); line-height: 1.5; }

  .notes-box { margin-top: 6mm; border-left: 3px solid var(--accent); padding: 3mm 5mm; background: #f8fafc; font-size: 9.5pt; }
  .notes-box h4 { margin: 0 0 1mm; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }

  /* Terms */
  .terms { page-break-before: always; }
  .terms-head { padding-bottom: 4mm; border-bottom: 1px solid var(--line); margin-bottom: 6mm; }
  .terms-head h1 { margin: 0; font-size: 16pt; }
  .terms-head .meta { color: var(--muted); font-size: 9pt; margin-top: 1mm; }

  .clause { margin-bottom: 5mm; page-break-inside: avoid; }
  .clause h2 { font-size: 11pt; margin: 0 0 2mm; }
  .clause p { margin: 0 0 2mm; }
  .clause ul { margin: 0 0 2mm; padding-left: 6mm; }
  .clause li { margin-bottom: 1.5mm; }
  .callout { border: 1px solid; border-radius: 4px; padding: 3mm 4mm; margin: 2mm 0 3mm; page-break-inside: avoid; }
  .callout-title { font-weight: 700; margin: 0 0 1mm; }
  .callout-primary { border-color: var(--accent); background: var(--accent-bg); }
  .callout-warning { border-color: var(--warn); background: var(--warn-bg); }
  .muted { color: var(--muted); font-size: 9pt; }
</style>
</head>
<body>

<section class="cover">
  <div class="cover-head">
    <div>
      <div class="brand">EnviroIQ</div>
      <div class="brand-sub">Frerken Companies Limited · enviroiq.net</div>
    </div>
    <div class="doc-meta">
      <div>Order Form &amp; Master Agreement</div>
      <div>Generated: ${esc(fmtDateTime(input.generatedAt))}</div>
      <div>Ref: <span class="ref">${esc(input.contractRef)}</span></div>
      <div>Terms version: ${esc(CONTRACT_TERMS_VERSION)} · ${esc(CONTRACT_TERMS_LAST_UPDATED)}</div>
    </div>
  </div>

  <h1 class="cover-title">${partyName} — ${esc(input.planName)}</h1>
  <p class="cover-sub">This Order Form records the commercial terms agreed between EnviroIQ and the Customer, and incorporates the Master Terms set out from page 2.</p>

  <div class="parties">
    <div class="party">
      <h3>EnviroIQ (Supplier)</h3>
      <div class="party-name">Frerken Companies Limited</div>
      <div class="party-trading">trading as EnviroIQ</div>
      <div class="party-meta">
        New Zealand company<br />
        contact@frerkencompanies.com<br />
        enviroiq.net
      </div>
    </div>
    <div class="party">
      <h3>Customer</h3>
      <div class="party-name">${partyName}</div>
      ${tradingName}
      <div class="party-meta">
        ${input.industry ? `Industry: ${esc(input.industry)}<br />` : ""}
        ${input.country ? `Country: ${esc(input.country)}<br />` : ""}
        Org ref: <span style="font-family:SFMono-Regular,Menlo,Consolas,monospace;">${esc(input.orgSlug)}</span>
      </div>
    </div>
  </div>

  <table class="order-table">
    <tr><th>Plan</th><td>${esc(input.planName)}</td></tr>
    <tr><th>Subscription fee</th><td><span class="price-big">${v.monthlyDisplay}</span> per month <span style="color:var(--muted)">(${esc(input.currency)}, exclusive of GST)</span></td></tr>
    <tr><th>Billing cadence</th><td>${input.billingCadence === "annual" ? `Annual in advance — ${v.periodDisplay}` : `Monthly in advance — ${v.periodDisplay}`}</td></tr>
    <tr><th>Term</th><td>${input.termMonths} months — ${esc(fmtDate(input.startDate))} to ${esc(fmtDate(endDate))}</td></tr>
    <tr><th>Custom integration</th><td>${input.customIntegration ? "<strong>Yes</strong> — clause 6 12-month notice / 80% early termination charge applies" : "No"}</td></tr>
    <tr class="order-total"><th>Total contract value</th><td><span class="price-big">${v.totalDisplay}</span> <span style="color:var(--muted)">over ${input.termMonths} months, exclusive of GST</span></td></tr>
  </table>

  ${input.notes ? `<div class="notes-box"><h4>Order notes</h4><div>${esc(input.notes).replace(/\n/g, "<br />")}</div></div>` : ""}

  <div class="accept-box">
    <h3>Acceptance</h3>
    <p style="margin:0 0 4mm;font-size:10pt;">The Customer accepts this Order Form and the Master Terms attached, on the date and by the person recorded below.</p>
    <div class="accept-grid">
      <div><span class="label">Signed by</span><span class="value">${esc(input.signerName)}</span></div>
      <div><span class="label">Title</span><span class="value">${esc(input.signerTitle || "—")}</span></div>
      <div><span class="label">Email</span><span class="value">${esc(input.signerEmail)}</span></div>
      <div><span class="label">Date &amp; time</span><span class="value">${esc(fmtDateTime(input.signedAt))}</span></div>
      ${input.signedIp ? `<div><span class="label">IP address</span><span class="value mono">${esc(input.signedIp)}</span></div>` : ""}
      ${input.signedUserAgent ? `<div><span class="label">User agent</span><span class="value mono">${esc(input.signedUserAgent)}</span></div>` : ""}
    </div>
    <p class="accept-note">The acceptance metadata above was captured by the EnviroIQ admin console at the time the contract was recorded. This document is the authoritative record of the agreement and supersedes any prior verbal or written quotes.</p>
  </div>
</section>

<section class="terms">
  <div class="terms-head">
    <h1>Master Terms</h1>
    <div class="meta">EnviroIQ Terms and Conditions · Version ${esc(CONTRACT_TERMS_VERSION)} · Last updated ${esc(CONTRACT_TERMS_LAST_UPDATED)}</div>
  </div>
  ${clausesHtml}
</section>

</body>
</html>`;
}
