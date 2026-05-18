/**
 * Contract / Order Form PDF template.
 *
 * Renders a cover page + commercial Order Form + Master Terms styled to match
 * the EnviroIQ ESG Board Pack visual language (dark navy cover, green accent,
 * card-based KPI display, slim sans serif body). Printed to PDF via the shared
 * puppeteer wrapper in ./pdf.ts.
 *
 * The legal clauses below are kept in lock-step with
 * artifacts/marketing/src/pages/terms.tsx (version 1.0, 5 May 2026). When the
 * marketing terms change, bump CONTRACT_TERMS_VERSION below and update both.
 */

export const CONTRACT_TERMS_VERSION = "1.0";
export const CONTRACT_TERMS_LAST_UPDATED = "5 May 2026";

export type ContractRenderInput = {
  orgName: string;
  orgSlug: string;
  industry?: string | null;
  country?: string | null;
  legalEntityName?: string | null;

  planName: string;
  monthlyPriceMinor: number;
  currency: string;
  billingCadence: "monthly" | "annual";
  termMonths: number;
  startDate: Date;
  customIntegration: boolean;
  notes?: string | null;

  signerName: string;
  /** Stored in the audit log but intentionally NOT printed on the PDF. */
  signerEmail: string;
  signerTitle?: string | null;
  signedAt: Date;
  signedIp?: string | null;
  signedUserAgent?: string | null;

  contractRef: string;
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

/** Clauses mirrored from marketing/src/pages/terms.tsx — keep in sync. */
const CLAUSES: { id: string; title: string; html: string }[] = [
  {
    id: "1",
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
    id: "2",
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
    id: "3",
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
    id: "4",
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
    id: "5",
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
    id: "6",
    title: "6. Cancellation and notice periods",
    html: `
      <div class="callout callout-primary">
        <div class="callout-title">Standard subscriptions — 3 months' notice</div>
        <p>Either party may cancel the Service by giving the other party at least
          <strong>three (3) months' written notice</strong>. The notice period runs from
          the first day of the calendar month following receipt of the notice. Fees
          remain payable in full for the entire notice period regardless of whether the
          Customer continues to use the Service.</p>
      </div>
      <div class="callout callout-warning">
        <div class="callout-title">Where Custom Integration has been delivered — 12 months' notice <em>or</em> Early Termination Charge</div>
        <p>Where EnviroIQ has performed any Custom Integration for the Customer (including
          any bespoke connector, data pipeline, embedded widget, white-labelled
          deployment, or engineering work scoped to the Customer), the Customer may
          cancel the Service only by either:</p>
        <ul>
          <li>giving at least <strong>twelve (12) months' written notice</strong>, with Fees payable in full for the entire notice period; <strong>or</strong></li>
          <li>paying an <strong>Early Termination Charge equal to eighty percent (80%) of the remaining contract value</strong> (calculated as the total Subscription Fees that would have been payable for the unexpired portion of the then-current Subscription Term and any signed renewal, exclusive of GST). The Early Termination Charge is due in a single payment on the date of cancellation.</li>
        </ul>
        <p class="callout-foot">The Customer chooses which option to take by stating it in the cancellation notice. If no option is stated, the 12-month notice period applies by default.</p>
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
    id: "7",
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
    id: "8",
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
    id: "9",
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
    id: "10",
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
    id: "11",
    title: "11. Confidentiality",
    html: `
      <p>Each party will keep confidential any non-public information of the other party
        that is identified as confidential or that a reasonable person would understand
        to be confidential, and use it only to perform its obligations or exercise its
        rights under these Terms.</p>
    `,
  },
  {
    id: "12",
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
    id: "13",
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
    id: "14",
    title: "14. Indemnity",
    html: `
      <p>The Customer indemnifies EnviroIQ against all losses, damages, claims and costs
        (including reasonable legal costs) arising from (a) Customer Data, (b) the
        Customer's breach of clause 9 (Acceptable use), or (c) the Customer's misuse of
        the outputs of the Service in a way that breaches law or third-party rights.</p>
    `,
  },
  {
    id: "15",
    title: "15. Force majeure",
    html: `
      <p>Neither party is liable for any failure or delay in performance (other than an
        obligation to pay money) caused by an event outside its reasonable control.</p>
    `,
  },
  {
    id: "16",
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
  const monthly = input.monthlyPriceMinor;
  const total = monthly * input.termMonths;
  const periodAmount = input.billingCadence === "annual" ? monthly * 12 : monthly;
  const monthlyDisplay = fmtMoney(monthly, input.currency);
  const periodDisplay = fmtMoney(periodAmount, input.currency);
  const totalDisplay = fmtMoney(total, input.currency);

  const endDate = new Date(input.startDate);
  endDate.setMonth(endDate.getMonth() + input.termMonths);

  const partyName = esc(input.legalEntityName?.trim() || input.orgName);
  const tradingLine = input.legalEntityName && input.legalEntityName.trim() !== input.orgName
    ? `<div class="party-trading">trading as ${esc(input.orgName)}</div>`
    : "";

  const refShort = input.contractRef.slice(0, 8);

  const clausesHtml = CLAUSES.map(
    (c) => `<section class="clause"><h3 class="clause-title">${esc(c.title)}</h3>${c.html}</section>`,
  ).join("");

  const css = `
    @page { size: A4; margin: 0; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; }
      .page { page-break-after: always; break-after: page; }
      .page:last-child { page-break-after: avoid; break-after: avoid; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { font-family: 'Inter', system-ui, -apple-system, sans-serif; background: #fff; color: #1e293b; font-size: 13px; line-height: 1.55; }

    /* ── Page chrome ──────────────────────────────────────────────────── */
    .page { width: 210mm; min-height: 297mm; display: flex; flex-direction: column; }
    .page-body { flex: 1; padding: 36px 48px 24px; }
    .page-footer { padding: 14px 48px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #94a3b8; font-weight: 500; }
    .page-footer-brand { font-weight: 700; color: #64748b; }

    /* ── Cover page ───────────────────────────────────────────────────── */
    .cover { background: #0f172a; color: #fff; }
    .cover-top { padding: 48px 56px 0; }
    .cover-brand { display: flex; align-items: center; gap: 10px; margin-bottom: 72px; }
    .cover-brand-dot { width: 12px; height: 12px; background: #22c55e; border-radius: 50%; }
    .cover-brand-name { font-size: 15px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8; }
    .cover-accent-line { width: 64px; height: 4px; background: #22c55e; border-radius: 2px; margin-bottom: 32px; }
    .cover-doc-type { font-size: 13px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #64748b; margin-bottom: 12px; }
    .cover-title { font-size: 42px; font-weight: 900; line-height: 1.1; color: #fff; margin-bottom: 8px; }
    .cover-subtitle { font-size: 18px; font-weight: 400; color: #94a3b8; margin-bottom: 48px; }
    .cover-company-block { background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 20px 28px; display: inline-block; }
    .cover-company-label { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    .cover-company-name { font-size: 26px; font-weight: 800; color: #f1f5f9; }
    .cover-company-sub { font-size: 13px; font-weight: 500; color: #94a3b8; margin-top: 4px; }
    .cover-meta { padding: 36px 56px; background: rgba(0,0,0,0.25); }
    .cover-meta-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; }
    .cover-meta-label { font-size: 10px; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    .cover-meta-value { font-size: 13px; font-weight: 600; color: #cbd5e1; }
    .cover-meta-value.mono { font-family: 'SFMono-Regular', Menlo, Consolas, monospace; font-size: 11px; }

    /* ── Section header (matches ESG Board Pack) ──────────────────────── */
    .section-header { background: #1e293b; color: #fff; padding: 20px 28px; border-radius: 10px; margin-bottom: 24px; }
    .section-header-eyebrow { font-size: 10px; font-weight: 600; letter-spacing: 0.12em; text-transform: uppercase; color: #64748b; margin-bottom: 4px; }
    .section-header-title { font-size: 20px; font-weight: 800; color: #f1f5f9; }
    .section-header-desc { font-size: 12px; color: #94a3b8; margin-top: 4px; }

    /* ── Parties grid ─────────────────────────────────────────────────── */
    .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .party-card { border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; background: #f8fafc; }
    .party-eyebrow { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #64748b; margin-bottom: 8px; }
    .party-name { font-size: 16px; font-weight: 800; color: #0f172a; }
    .party-trading { font-size: 12px; color: #64748b; margin-top: 2px; }
    .party-meta { margin-top: 10px; font-size: 11px; color: #475569; line-height: 1.7; }
    .party-meta .k { color: #94a3b8; font-weight: 600; }

    /* ── Commercial KPI cards ─────────────────────────────────────────── */
    .commercial-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
    .kpi-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 18px; }
    .kpi-card.featured { background: #0f172a; border-color: #0f172a; color: #fff; }
    .kpi-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 8px; }
    .kpi-card.featured .kpi-label { color: #64748b; }
    .kpi-value { font-size: 22px; font-weight: 900; color: #16a34a; line-height: 1.05; }
    .kpi-card.featured .kpi-value { color: #22c55e; font-size: 26px; }
    .kpi-sub { font-size: 11px; color: #64748b; margin-top: 6px; }
    .kpi-card.featured .kpi-sub { color: #94a3b8; }

    /* ── Detail table ─────────────────────────────────────────────────── */
    .detail-table { width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; margin-bottom: 16px; }
    .detail-table th, .detail-table td { padding: 12px 16px; text-align: left; font-size: 12px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .detail-table tr:last-child th, .detail-table tr:last-child td { border-bottom: none; }
    .detail-table th { background: #f8fafc; color: #64748b; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; font-size: 10px; width: 36%; }
    .detail-table td { color: #0f172a; font-weight: 500; }
    .detail-table td strong { font-weight: 700; }
    .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    .pill-warn { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }
    .pill-ok { background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0; }

    /* ── Notes ────────────────────────────────────────────────────────── */
    .notes-card { border-left: 3px solid #22c55e; background: #f0fdf4; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; }
    .notes-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #15803d; margin-bottom: 4px; }
    .notes-body { font-size: 12px; color: #374151; line-height: 1.6; white-space: pre-wrap; }

    /* ── Acceptance ───────────────────────────────────────────────────── */
    .accept { border: 2px solid #0f172a; border-radius: 10px; padding: 20px 24px; background: #fff; margin-top: 8px; }
    .accept-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
    .accept-title { font-size: 14px; font-weight: 800; color: #0f172a; }
    .accept-intro { font-size: 11px; color: #64748b; margin-bottom: 14px; line-height: 1.6; }
    .accept-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 16px; margin-bottom: 12px; }
    .accept-field-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #94a3b8; margin-bottom: 4px; }
    .accept-field-value { font-size: 13px; font-weight: 700; color: #0f172a; }
    .accept-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 4px; }
    .accept-meta .accept-field-value { font-size: 11px; font-weight: 500; color: #475569; font-family: 'SFMono-Regular', Menlo, Consolas, monospace; word-break: break-all; line-height: 1.5; }
    .accept-foot { font-size: 10px; color: #94a3b8; line-height: 1.6; margin-top: 12px; }

    /* ── Master terms ─────────────────────────────────────────────────── */
    .terms-body { padding: 36px 48px 24px; }
    .terms-intro { color: #64748b; font-size: 12px; margin-bottom: 20px; }
    .clause { margin-bottom: 18px; page-break-inside: avoid; }
    .clause-title { font-size: 13px; font-weight: 800; color: #0f172a; margin: 0 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0; }
    .clause p { font-size: 12px; color: #374151; line-height: 1.65; margin: 0 0 8px; }
    .clause ul { margin: 4px 0 8px 18px; padding: 0; }
    .clause li { font-size: 12px; color: #374151; line-height: 1.65; margin-bottom: 4px; }
    .clause strong { color: #0f172a; }
    .callout { border-radius: 8px; padding: 12px 16px; margin: 6px 0 10px; page-break-inside: avoid; }
    .callout-title { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 6px; }
    .callout-primary { background: #eff6ff; border: 1px solid #bfdbfe; }
    .callout-primary .callout-title { color: #1d4ed8; }
    .callout-warning { background: #fff7ed; border: 1px solid #fed7aa; }
    .callout-warning .callout-title { color: #c2410c; }
    .callout p, .callout li { font-size: 11px; }
    .callout-foot { font-size: 10px; color: #64748b; margin-top: 6px; }
  `;

  const footer = (page: string) =>
    `<div class="page-footer"><span class="page-footer-brand">EnviroIQ Order Form</span><span>— ${esc(input.orgName)} · Ref ${esc(refShort)} —</span><span>Page ${page}</span></div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>EnviroIQ Order Form — ${partyName}</title>
<style>${css}</style>
</head>
<body>

<!-- ══ PAGE 1: COVER ══════════════════════════════════════════════════════ -->
<div class="page cover">
  <div class="cover-top" style="padding-top:48px;">
    <div class="cover-brand">
      <div class="cover-brand-dot"></div>
      <div class="cover-brand-name">EnviroIQ &nbsp;·&nbsp; ESG Platform</div>
    </div>
    <div class="cover-accent-line"></div>
    <div class="cover-doc-type">Order Form &amp; Master Agreement</div>
    <div class="cover-title">Subscription Agreement</div>
    <div class="cover-subtitle">${esc(input.planName)} — ${input.termMonths} month term</div>
    <div class="cover-company-block">
      <div class="cover-company-label">Prepared for</div>
      <div class="cover-company-name">${partyName}</div>
      ${input.legalEntityName && input.legalEntityName.trim() !== input.orgName ? `<div class="cover-company-sub">trading as ${esc(input.orgName)}</div>` : ""}
    </div>
  </div>
  <div style="flex:1;"></div>
  <div class="cover-meta">
    <div class="cover-meta-grid">
      <div>
        <div class="cover-meta-label">Generated</div>
        <div class="cover-meta-value">${esc(fmtDateTime(input.generatedAt))}</div>
      </div>
      <div>
        <div class="cover-meta-label">Terms version</div>
        <div class="cover-meta-value">v${esc(CONTRACT_TERMS_VERSION)} · ${esc(CONTRACT_TERMS_LAST_UPDATED)}</div>
      </div>
      <div>
        <div class="cover-meta-label">Contract reference</div>
        <div class="cover-meta-value mono">${esc(input.contractRef)}</div>
      </div>
    </div>
  </div>
</div>

<!-- ══ PAGE 2: ORDER FORM ════════════════════════════════════════════════ -->
<div class="page">
  <div class="page-body">
    <div class="section-header">
      <div class="section-header-eyebrow">Section 1</div>
      <div class="section-header-title">Order Form</div>
      <div class="section-header-desc">Commercial terms agreed between EnviroIQ and the Customer. Incorporates the Master Terms attached.</div>
    </div>

    <div class="parties">
      <div class="party-card">
        <div class="party-eyebrow">EnviroIQ (Supplier)</div>
        <div class="party-name">Frerken Companies Limited</div>
        <div class="party-trading">trading as EnviroIQ</div>
        <div class="party-meta">
          <span class="k">Jurisdiction</span> New Zealand<br/>
          <span class="k">Contact</span> contact@frerkencompanies.com<br/>
          <span class="k">Web</span> enviroiq.net
        </div>
      </div>
      <div class="party-card">
        <div class="party-eyebrow">Customer</div>
        <div class="party-name">${partyName}</div>
        ${tradingLine}
        <div class="party-meta">
          ${input.industry ? `<span class="k">Industry</span> ${esc(input.industry)}<br/>` : ""}
          ${input.country ? `<span class="k">Country</span> ${esc(input.country)}<br/>` : ""}
          <span class="k">Org ref</span> <span style="font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:11px;">${esc(input.orgSlug)}</span>
        </div>
      </div>
    </div>

    <div class="commercial-grid">
      <div class="kpi-card">
        <div class="kpi-label">Monthly subscription</div>
        <div class="kpi-value">${monthlyDisplay}</div>
        <div class="kpi-sub">${esc(input.currency)} · exclusive of GST</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">Billing cadence</div>
        <div class="kpi-value" style="font-size:18px;">${input.billingCadence === "annual" ? "Annual in advance" : "Monthly in advance"}</div>
        <div class="kpi-sub">${periodDisplay} per ${input.billingCadence === "annual" ? "year" : "month"}</div>
      </div>
      <div class="kpi-card featured">
        <div class="kpi-label">Total contract value</div>
        <div class="kpi-value">${totalDisplay}</div>
        <div class="kpi-sub">${input.termMonths} months · excl. GST</div>
      </div>
    </div>

    <table class="detail-table">
      <tr><th>Plan</th><td><strong>${esc(input.planName)}</strong></td></tr>
      <tr><th>Subscription term</th><td>${input.termMonths} months — ${esc(fmtDate(input.startDate))} to ${esc(fmtDate(endDate))}</td></tr>
      <tr><th>Custom integration</th><td>${input.customIntegration
        ? `<span class="pill pill-warn">Yes</span> &nbsp; Clause 6 applies — 12-month notice or 80% early-termination charge`
        : `<span class="pill pill-ok">No</span> &nbsp; Standard clause 6 — 3 months' notice`}</td></tr>
      <tr><th>Governing law</th><td>Laws of New Zealand · exclusive jurisdiction of the NZ courts</td></tr>
    </table>

    ${input.notes ? `<div class="notes-card"><div class="notes-label">Order notes</div><div class="notes-body">${esc(input.notes)}</div></div>` : ""}

    <div class="accept">
      <div class="accept-head">
        <div class="accept-title">Acceptance</div>
        <div style="font-size:10px;color:#94a3b8;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;">Recorded electronically</div>
      </div>
      <div class="accept-intro">
        The Customer accepts this Order Form and the Master Terms attached, on the date and by the person recorded below.
      </div>
      <div class="accept-grid">
        <div>
          <div class="accept-field-label">Signed by</div>
          <div class="accept-field-value">${esc(input.signerName)}</div>
        </div>
        <div>
          <div class="accept-field-label">Title</div>
          <div class="accept-field-value">${esc(input.signerTitle || "—")}</div>
        </div>
        <div>
          <div class="accept-field-label">Date &amp; time</div>
          <div class="accept-field-value">${esc(fmtDateTime(input.signedAt))}</div>
        </div>
      </div>
      ${input.signedIp || input.signedUserAgent ? `
      <div class="accept-meta">
        ${input.signedIp ? `<div><div class="accept-field-label">IP address</div><div class="accept-field-value">${esc(input.signedIp)}</div></div>` : "<div></div>"}
        ${input.signedUserAgent ? `<div><div class="accept-field-label">User agent</div><div class="accept-field-value">${esc(input.signedUserAgent)}</div></div>` : ""}
      </div>` : ""}
      <div class="accept-foot">
        The acceptance metadata above was captured by the EnviroIQ admin console at the time the contract was recorded.
        This document is the authoritative record of the agreement and supersedes any prior verbal or written quotes.
      </div>
    </div>
  </div>
  ${footer("2")}
</div>

<!-- ══ PAGE 3+: MASTER TERMS ═════════════════════════════════════════════ -->
<div class="page">
  <div class="terms-body">
    <div class="section-header">
      <div class="section-header-eyebrow">Section 2</div>
      <div class="section-header-title">Master Terms</div>
      <div class="section-header-desc">EnviroIQ Terms and Conditions · Version ${esc(CONTRACT_TERMS_VERSION)} · Last updated ${esc(CONTRACT_TERMS_LAST_UPDATED)}</div>
    </div>
    <p class="terms-intro">These Master Terms govern the Customer's use of the EnviroIQ platform and form part of the Order Form on page 2.</p>
    ${clausesHtml}
  </div>
  ${footer("3")}
</div>

</body>
</html>`;
}
