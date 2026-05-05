import { motion } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { usePageMeta, PAGE_META } from "@/lib/use-page-meta";
import { ScrollText, AlertTriangle } from "lucide-react";

const fadeIn = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

const LAST_UPDATED = "5 May 2026";
const VERSION = "1.0";

interface Clause {
  id: string;
  title: string;
  body: React.ReactNode;
}

const CLAUSES: Clause[] = [
  {
    id: "1-parties",
    title: "1. Parties and acceptance",
    body: (
      <>
        <p>
          These Terms and Conditions ("Terms") form a binding agreement between{" "}
          <strong>Frerken Companies Limited</strong>, a New Zealand company trading as{" "}
          <strong>EnviroIQ</strong> ("EnviroIQ", "we", "us", "our"), and the
          organisation that subscribes to the EnviroIQ platform ("Customer", "you", "your").
        </p>
        <p>
          By signing an Order Form, accepting an electronic quote, clicking "I agree", or
          accessing or using the EnviroIQ platform ("Service"), you confirm that you have
          authority to bind the Customer and that the Customer accepts these Terms. If you
          do not accept these Terms, you must not use the Service.
        </p>
      </>
    ),
  },
  {
    id: "2-definitions",
    title: "2. Definitions",
    body: (
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Order Form</strong> means a written or electronic order, quote, proposal or statement of work signed or accepted by both parties that references these Terms.</li>
        <li><strong>Subscription Term</strong> means the period of paid access to the Service set out in the Order Form (and any renewals).</li>
        <li><strong>Customer Data</strong> means data submitted to the Service by or on behalf of the Customer, including emissions, fleet, energy, supplier and operational data.</li>
        <li><strong>Custom Integration</strong> means any bespoke integration, connector, data pipeline, API, embedded widget, white-labelled deployment, or engineering work scoped specifically for the Customer and recorded in an Order Form or Statement of Work.</li>
        <li><strong>Fees</strong> means the subscription, integration, professional services and other charges set out in the Order Form.</li>
      </ul>
    ),
  },
  {
    id: "3-service",
    title: "3. The Service",
    body: (
      <>
        <p>
          EnviroIQ grants the Customer a non-exclusive, non-transferable, non-sublicensable
          right to access and use the Service during the Subscription Term, for the
          Customer's internal business operations and for the number of users specified in
          the Order Form, subject to these Terms and the Software Licence Agreement
          published at <a href="/license" className="text-primary underline">enviroiq.net/license</a>.
        </p>
        <p>
          We may improve, modify, add to or remove features at any time. We will not
          materially reduce the core functionality the Customer is paying for during a
          paid Subscription Term without reasonable notice.
        </p>
      </>
    ),
  },
  {
    id: "4-fees",
    title: "4. Fees and payment",
    body: (
      <>
        <p>
          The Customer must pay the Fees set out in the Order Form. Unless the Order Form
          says otherwise:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>Subscription Fees are invoiced monthly or annually in advance.</li>
          <li>Custom Integration and professional services Fees are invoiced 50% on commencement and 50% on delivery, unless an alternative milestone schedule is agreed.</li>
          <li>All Fees are exclusive of GST and any other applicable taxes, which the Customer must pay in addition.</li>
          <li>Invoices are payable within <strong>14 days</strong> of the invoice date.</li>
          <li>Overdue amounts accrue interest at 1.5% per month (or the maximum rate permitted by law, whichever is lower) and the Customer must reimburse reasonable collection costs.</li>
        </ul>
        <p>
          We may adjust Subscription Fees at the start of any renewal term by giving at
          least 30 days' written notice. Fees are not adjusted mid-term except where
          additional users, modules or volume tiers are added.
        </p>
      </>
    ),
  },
  {
    id: "5-term",
    title: "5. Term and renewal",
    body: (
      <>
        <p>
          These Terms commence on the date the first Order Form is accepted and continue
          until terminated in accordance with these Terms. Each Order Form has its own
          Subscription Term as stated in that Order Form. Unless either party gives notice
          of non-renewal in accordance with clause 6, each Subscription Term automatically
          renews for successive periods equal to the initial Subscription Term.
        </p>
      </>
    ),
  },
  {
    id: "6-cancellation",
    title: "6. Cancellation and notice periods",
    body: (
      <>
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-5 mb-5">
          <p className="font-bold text-foreground mb-2">Standard subscriptions — 3 months' notice</p>
          <p>
            Either party may cancel the Service by giving the other party at least{" "}
            <strong>three (3) months' written notice</strong>. The notice period runs from
            the first day of the calendar month following receipt of the notice. Fees
            remain payable in full for the entire notice period regardless of whether the
            Customer continues to use the Service.
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-5 mb-5">
          <p className="font-bold text-foreground mb-2">Where Custom Integration has been delivered — 12 months' notice <em>or</em> Early Termination Charge</p>
          <p className="mb-3">
            Where EnviroIQ has performed any Custom Integration for the Customer (including
            any bespoke connector, data pipeline, embedded widget, white-labelled
            deployment, or engineering work scoped to the Customer), the Customer may
            cancel the Service only by either:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              giving at least <strong>twelve (12) months' written notice</strong>, with
              Fees payable in full for the entire notice period; <strong>or</strong>
            </li>
            <li>
              paying an <strong>Early Termination Charge equal to eighty percent (80%) of
              the remaining contract value</strong> (calculated as the total Subscription
              Fees that would have been payable for the unexpired portion of the then-
              current Subscription Term and any signed renewal, exclusive of GST). The
              Early Termination Charge is due in a single payment on the date of
              cancellation.
            </li>
          </ul>
          <p className="mt-3 text-sm text-muted-foreground">
            The Customer chooses which option to take by stating it in the cancellation
            notice. If no option is stated, the 12-month notice period applies by default.
          </p>
        </div>

        <p>
          The cancellation provisions in this clause 6 reflect that Custom Integration
          work involves up-front engineering investment by EnviroIQ that is amortised over
          the expected life of the engagement, and that EnviroIQ would not perform Custom
          Integration on the same commercial terms absent this commitment.
        </p>
        <p>
          Cancellation does not relieve the Customer of any Fees accrued before the
          effective date of cancellation, and EnviroIQ is not required to refund any
          prepaid Fees on cancellation by the Customer.
        </p>
      </>
    ),
  },
  {
    id: "7-termination",
    title: "7. Termination for cause",
    body: (
      <>
        <p>Either party may terminate these Terms (and any Order Form) immediately by written notice if:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>the other party commits a material breach that is not remedied within 14 days of written notice; or</li>
          <li>the other party becomes insolvent, has a receiver, liquidator, statutory manager, voluntary administrator or similar appointed, ceases to carry on business, or is unable to pay its debts as they fall due.</li>
        </ul>
        <p>
          EnviroIQ may also suspend or terminate the Service immediately on written notice
          if the Customer fails to pay any undisputed invoice within 14 days of the due
          date, or where continued provision of the Service would expose EnviroIQ to legal
          or regulatory risk.
        </p>
        <p>
          Where the Customer terminates for EnviroIQ's uncured material breach, the
          Customer is entitled to a pro-rata refund of prepaid Subscription Fees for the
          unused portion of the then-current Subscription Term, and the cancellation
          notice and Early Termination Charge provisions in clause 6 do not apply.
        </p>
      </>
    ),
  },
  {
    id: "8-customer-data",
    title: "8. Customer Data",
    body: (
      <>
        <p>
          As between the parties, the Customer owns all Customer Data. The Customer grants
          EnviroIQ a non-exclusive, royalty-free licence to host, copy, transmit, process,
          analyse, display and otherwise use Customer Data solely to provide and improve
          the Service, to produce de-identified and aggregated analytics, and to comply
          with law.
        </p>
        <p>
          The Customer is responsible for the accuracy, quality and legality of Customer
          Data, for obtaining all necessary consents, and for ensuring its use of the
          Service complies with applicable law (including the Privacy Act 2020).
        </p>
        <p>
          On request following termination, EnviroIQ will provide the Customer a one-time
          export of Customer Data in a commonly used machine-readable format. Thirty (30)
          days after termination EnviroIQ may delete Customer Data from production
          systems; backups are purged on a rolling basis in line with EnviroIQ's standard
          retention schedule.
        </p>
      </>
    ),
  },
  {
    id: "9-acceptable-use",
    title: "9. Acceptable use",
    body: (
      <>
        <p>The Customer must not, and must not allow any user to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>use the Service in breach of any law, regulation or third-party right;</li>
          <li>upload data containing malicious code or attempt to interfere with the Service's security or integrity;</li>
          <li>resell, rent, sublicense or make the Service available to any third party except as expressly permitted under an Order Form;</li>
          <li>reverse-engineer, decompile or disassemble the Service, or attempt to derive its source code, except to the extent the law expressly permits;</li>
          <li>use the Service to build a competing product, or benchmark it for the purpose of publication without EnviroIQ's prior written consent.</li>
        </ul>
      </>
    ),
  },
  {
    id: "10-ip",
    title: "10. Intellectual property",
    body: (
      <>
        <p>
          EnviroIQ (and its licensors) own all intellectual property rights in the Service,
          including all software, methodologies, emission factor catalogues, calculation
          engines, dashboards, documentation, and any improvements, derivatives or
          feedback-based changes. Nothing in these Terms transfers any of those rights to
          the Customer beyond the licence to use the Service granted in clause 3.
        </p>
        <p>
          Where EnviroIQ delivers Custom Integration work, EnviroIQ retains ownership of
          all underlying frameworks, libraries, tooling and platform code; the Customer
          receives a perpetual, non-exclusive licence to use the Custom Integration solely
          in connection with its use of the Service.
        </p>
      </>
    ),
  },
  {
    id: "11-confidentiality",
    title: "11. Confidentiality",
    body: (
      <p>
        Each party will keep confidential any non-public information of the other party
        that is identified as confidential or that a reasonable person would understand to
        be confidential, and use it only to perform its obligations or exercise its rights
        under these Terms. This obligation does not apply to information that is public
        through no breach of these Terms, was already lawfully known, is independently
        developed, or is required to be disclosed by law or by a regulator (with prompt
        notice to the other party where lawful).
      </p>
    ),
  },
  {
    id: "12-warranties",
    title: "12. Warranties and disclaimers",
    body: (
      <>
        <p>
          EnviroIQ warrants that it will provide the Service with reasonable care and
          skill. Except as expressly stated, the Service is provided "as is" and EnviroIQ
          excludes, to the fullest extent permitted by law, all other warranties whether
          express, implied or statutory, including any warranties of merchantability,
          fitness for a particular purpose and non-infringement.
        </p>
        <p>
          The Customer acknowledges that the Service produces estimates, calculations and
          dashboards based on the data and methodologies available, and that the Customer
          is responsible for reviewing the outputs before relying on them for regulatory,
          board or audit purposes.
        </p>
        <p className="text-sm text-muted-foreground">
          Where the Customer acquires the Service for the purpose of a business, the
          parties agree that the Consumer Guarantees Act 1993 does not apply to the
          supply of the Service, to the maximum extent permitted by law.
        </p>
      </>
    ),
  },
  {
    id: "13-liability",
    title: "13. Limitation of liability",
    body: (
      <>
        <p>
          To the fullest extent permitted by law, neither party is liable to the other
          for any loss of profit, loss of revenue, loss of business, loss of anticipated
          savings, loss of goodwill or for any indirect, special, incidental,
          consequential or punitive damages arising out of or in connection with these
          Terms or the Service, even if advised of the possibility of such loss.
        </p>
        <p>
          Each party's total aggregate liability arising out of or in connection with
          these Terms in any 12-month period is limited to the Fees paid by the Customer
          to EnviroIQ in the 12 months preceding the event giving rise to the claim.
        </p>
        <p>
          The limits in this clause do not apply to: (a) the Customer's obligation to pay
          Fees; (b) breach of confidentiality; (c) infringement of intellectual property
          rights; or (d) any liability that cannot lawfully be excluded.
        </p>
      </>
    ),
  },
  {
    id: "14-indemnity",
    title: "14. Indemnity",
    body: (
      <p>
        The Customer indemnifies EnviroIQ against all losses, damages, claims and costs
        (including reasonable legal costs) arising from (a) Customer Data, (b) the
        Customer's breach of clause 9 (Acceptable use), or (c) the Customer's misuse of
        the outputs of the Service in a way that breaches law or third-party rights.
      </p>
    ),
  },
  {
    id: "15-force-majeure",
    title: "15. Force majeure",
    body: (
      <p>
        Neither party is liable for any failure or delay in performance (other than an
        obligation to pay money) caused by an event outside its reasonable control,
        including natural disaster, pandemic, war, terrorism, civil unrest, internet or
        telecommunications outages, strikes, governmental action, or denial-of-service or
        other malicious attacks on infrastructure.
      </p>
    ),
  },
  {
    id: "16-changes",
    title: "16. Changes to these Terms",
    body: (
      <p>
        We may update these Terms from time to time. The current version is always
        published at <a href="/terms" className="text-primary underline">enviroiq.net/terms</a>.
        For changes that materially reduce the Customer's rights, we will give at least 30
        days' notice by email to the Customer's nominated billing contact and the changes
        take effect at the start of the next renewal term.
      </p>
    ),
  },
  {
    id: "17-general",
    title: "17. General",
    body: (
      <ul className="list-disc pl-6 space-y-2">
        <li><strong>Entire agreement:</strong> these Terms together with each Order Form and the Software Licence Agreement form the entire agreement between the parties on the subject matter and supersede all prior arrangements.</li>
        <li><strong>Order of precedence:</strong> if there is a conflict, the Order Form prevails over these Terms, and these Terms prevail over the Software Licence Agreement.</li>
        <li><strong>Assignment:</strong> the Customer may not assign these Terms without EnviroIQ's prior written consent (not to be unreasonably withheld). EnviroIQ may assign on notice in connection with a sale of business, merger or restructure.</li>
        <li><strong>Notices:</strong> notices must be in writing and sent by email to the contact addresses recorded in the Order Form. Notices to EnviroIQ must be copied to <a className="text-primary underline" href="mailto:contact@frerkencompanies.com">contact@frerkencompanies.com</a>.</li>
        <li><strong>Governing law:</strong> these Terms are governed by the laws of New Zealand. The parties submit to the exclusive jurisdiction of the New Zealand courts.</li>
        <li><strong>Disputes:</strong> the parties will attempt to resolve any dispute by good-faith discussion before commencing proceedings (other than urgent injunctive relief).</li>
        <li><strong>No waiver:</strong> failure or delay in enforcing any right is not a waiver of that right.</li>
        <li><strong>Severability:</strong> if any provision is found unenforceable, the rest of these Terms remain in effect.</li>
        <li><strong>Survival:</strong> clauses that by their nature should survive termination (including IP, confidentiality, liability, indemnity and governing law) survive termination.</li>
      </ul>
    ),
  },
  {
    id: "18-contact",
    title: "18. Contact",
    body: (
      <p>
        Questions about these Terms can be sent to{" "}
        <a className="text-primary underline" href="mailto:contact@frerkencompanies.com">
          contact@frerkencompanies.com
        </a>
        .
      </p>
    ),
  },
];

export default function Terms() {
  usePageMeta(PAGE_META.terms);
  return (
    <div className="min-h-screen bg-background selection:bg-primary/20">
      <Navbar />

      <main>
        {/* Hero */}
        <section className="relative pt-32 pb-12 md:pt-40 md:pb-16">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
          <div className="container mx-auto px-6 relative">
            <motion.div
              initial="hidden"
              animate="show"
              variants={{ hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08 } } }}
              className="max-w-4xl"
            >
              <motion.div variants={fadeIn} className="mb-6 flex flex-wrap items-center gap-3">
                <Badge variant="outline" className="border-primary/30 text-primary bg-primary/8 px-3 py-1">
                  <ScrollText className="w-3 h-3 mr-2" />
                  Legal
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">
                  VERSION {VERSION} · LAST UPDATED {LAST_UPDATED.toUpperCase()}
                </span>
              </motion.div>

              <motion.h1
                variants={fadeIn}
                className="text-4xl md:text-5xl font-bold tracking-tighter mb-6 leading-[1.1]"
              >
                Terms and Conditions
              </motion.h1>

              <motion.p
                variants={fadeIn}
                className="text-lg text-muted-foreground max-w-3xl leading-relaxed"
              >
                These Terms govern every subscription to the EnviroIQ platform. Read them
                alongside your Order Form and the{" "}
                <a href="/license" className="text-primary underline">Software Licence Agreement</a>.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Highlights callout */}
        <section className="pb-12">
          <div className="container mx-auto px-6">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="max-w-4xl rounded-2xl border border-amber-500/30 bg-amber-500/5 p-6 flex items-start gap-4"
            >
              <AlertTriangle className="w-5 h-5 text-amber-500 mt-1 shrink-0" />
              <div className="space-y-2 text-sm leading-relaxed">
                <p className="font-bold text-foreground">Cancellation at a glance</p>
                <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
                  <li>
                    Standard subscriptions can be cancelled with{" "}
                    <strong className="text-foreground">three (3) months' written notice</strong>.
                  </li>
                  <li>
                    Where Custom Integration has been delivered, cancellation requires either{" "}
                    <strong className="text-foreground">twelve (12) months' written notice</strong>{" "}
                    or an{" "}
                    <strong className="text-foreground">
                      Early Termination Charge of 80% of the remaining contract value
                    </strong>
                    .
                  </li>
                  <li>Full detail in clause 6 below.</li>
                </ul>
              </div>
            </motion.div>
          </div>
        </section>

        {/* TOC + clauses */}
        <section className="pb-32">
          <div className="container mx-auto px-6">
            <div className="grid lg:grid-cols-[260px_1fr] gap-10 max-w-6xl">
              {/* TOC */}
              <aside className="lg:sticky lg:top-28 lg:self-start">
                <p className="text-xs font-mono text-primary mb-3 tracking-wider">CONTENTS</p>
                <ul className="space-y-1.5 text-sm">
                  {CLAUSES.map((c) => (
                    <li key={c.id}>
                      <a
                        href={`#${c.id}`}
                        className="text-muted-foreground hover:text-primary transition-colors block"
                      >
                        {c.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </aside>

              {/* Body */}
              <div className="space-y-10">
                {CLAUSES.map((c) => (
                  <article
                    key={c.id}
                    id={c.id}
                    className="scroll-mt-28 prose prose-slate dark:prose-invert max-w-none"
                  >
                    <h2 className="text-2xl font-bold text-foreground mb-4">{c.title}</h2>
                    <div className="space-y-4 text-[15px] leading-relaxed text-muted-foreground">
                      {c.body}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
