import { motion } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { usePageMeta, PAGE_META } from "@/lib/use-page-meta";
import { KeyRound } from "lucide-react";

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
    id: "1-grant",
    title: "1. Licence grant",
    body: (
      <>
        <p>
          Subject to the Customer's continuing compliance with this Software Licence
          Agreement ("Licence"), the Terms and Conditions published at{" "}
          <a href="/terms" className="text-primary underline">enviroiq.net/terms</a>{" "}
          ("Terms") and payment of all Fees, EnviroIQ grants the Customer a limited,
          non-exclusive, non-transferable, non-sublicensable, revocable right during the
          Subscription Term to:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>access and use the EnviroIQ platform and its associated APIs, dashboards, mobile applications, embeddable widgets and documentation (together, the "Software") for the Customer's internal business purposes;</li>
          <li>permit the number of named users specified in the Order Form to use the Software, each under their own individual login; and</li>
          <li>generate, view, export and share outputs (reports, dashboards, board PDFs and evidence packs) with the Customer's auditors, regulators, advisors and counterparties as reasonably required.</li>
        </ul>
      </>
    ),
  },
  {
    id: "2-restrictions",
    title: "2. Restrictions",
    body: (
      <>
        <p>The Customer must not, and must not permit any user or third party to:</p>
        <ul className="list-disc pl-6 space-y-2">
          <li>copy, modify, adapt, translate or create derivative works of the Software;</li>
          <li>reverse-engineer, decompile, disassemble or otherwise attempt to derive the source code, object code or underlying ideas, algorithms, structure or organisation of the Software, except to the extent the law expressly permits and that right cannot be excluded;</li>
          <li>rent, lease, sell, sublicense, distribute, transfer, host as a service, or otherwise commercially exploit the Software or any part of it;</li>
          <li>remove, obscure or alter any proprietary, copyright, trade-mark or confidentiality notice in the Software or its outputs;</li>
          <li>use the Software to build, train or improve any product or service that competes with EnviroIQ;</li>
          <li>use the Software to perform competitive benchmarking, scraping, mass data extraction or any activity intended to characterise EnviroIQ's methodologies, emission factor versions or calculation engines for publication;</li>
          <li>introduce viruses, worms, time bombs, malicious code or any code that disrupts the integrity, availability or confidentiality of the Software;</li>
          <li>circumvent or attempt to circumvent any access controls, rate limits, billing controls or licence enforcement;</li>
          <li>use the Software in breach of any applicable law, regulation or third-party right; or</li>
          <li>permit access to the Software by any user other than a permitted named user (sharing of credentials between people is prohibited).</li>
        </ul>
      </>
    ),
  },
  {
    id: "3-ip",
    title: "3. Ownership",
    body: (
      <>
        <p>
          The Software, all Updates (defined below), all Custom Integration code and
          frameworks, all emission factor catalogues curated by EnviroIQ, all calculation
          engines, all dashboard templates, all evidence-pack manifests, all underlying
          data models, and all intellectual property rights in any of the foregoing, are
          and remain the exclusive property of EnviroIQ and its licensors.
        </p>
        <p>
          No rights are granted to the Customer in the Software except those expressly
          granted in this Licence. All rights not expressly granted are reserved.
        </p>
        <p>
          To the extent the Customer or any user provides feedback, suggestions or ideas
          to EnviroIQ, the Customer assigns to EnviroIQ all rights in that feedback and
          EnviroIQ may use it for any purpose without obligation.
        </p>
      </>
    ),
  },
  {
    id: "4-customer-data",
    title: "4. Customer Data licence",
    body: (
      <p>
        As between the parties, the Customer owns all data the Customer uploads or that
        is collected from the Customer's connected systems. The Customer grants EnviroIQ
        the licence described in clause 8 of the Terms to host, process, transmit and
        analyse that data solely to provide the Software and to generate de-identified,
        aggregated analytics. EnviroIQ does not sell Customer Data and does not use
        identifiable Customer Data to train shared third-party AI models.
      </p>
    ),
  },
  {
    id: "5-updates",
    title: "5. Updates and changes",
    body: (
      <>
        <p>
          EnviroIQ may at any time release patches, new versions, additional features or
          replacement components of the Software ("Updates"). Updates form part of the
          Software and are licensed on the same terms.
        </p>
        <p>
          EnviroIQ may discontinue, replace or modify any feature on reasonable notice.
          Where a discontinuation materially reduces functionality during a paid
          Subscription Term, EnviroIQ will use reasonable efforts to provide an
          equivalent replacement or, failing that, a pro-rata refund of prepaid Fees for
          the affected functionality.
        </p>
      </>
    ),
  },
  {
    id: "6-api",
    title: "6. API and integration use",
    body: (
      <>
        <p>
          Where the Customer uses EnviroIQ's APIs, embedded widgets, webhook outputs or
          Custom Integrations, the Customer must:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>protect API keys and credentials with the same care as its own confidential information;</li>
          <li>respect documented rate limits and fair-use thresholds, and not use the API to bulk-export the entire dataset for the purpose of replicating the Software elsewhere;</li>
          <li>maintain accurate attribution where attribution is required by the documentation;</li>
          <li>promptly notify EnviroIQ of any suspected credential compromise.</li>
        </ul>
        <p>
          EnviroIQ may suspend any API key, integration or user account it reasonably
          believes is being used in breach of this clause or clause 2.
        </p>
      </>
    ),
  },
  {
    id: "7-third-party",
    title: "7. Third-party components",
    body: (
      <p>
        The Software incorporates open-source and third-party components, each licensed
        under its own terms. Those terms apply to those components only and do not
        change the licence the Customer receives in the rest of the Software. A current
        list of significant third-party components is available on request to{" "}
        <a className="text-primary underline" href="mailto:contact@frerkencompanies.com">
          contact@frerkencompanies.com
        </a>
        .
      </p>
    ),
  },
  {
    id: "8-suspension",
    title: "8. Suspension",
    body: (
      <p>
        EnviroIQ may suspend the Customer's access to the Software in whole or in part,
        on notice, where: (a) the Customer materially breaches this Licence or the Terms;
        (b) any undisputed invoice is more than 14 days overdue; (c) suspension is
        required by law or to protect the security or integrity of the Software or other
        customers; or (d) the Customer's use poses a credible risk of legal liability to
        EnviroIQ. Suspension does not relieve the Customer of any payment obligation.
      </p>
    ),
  },
  {
    id: "9-termination",
    title: "9. Termination of Licence",
    body: (
      <>
        <p>
          This Licence terminates automatically and without further notice on termination
          or expiry of the Subscription Term under the Terms, or on the Customer's
          material breach of clause 2 (Restrictions) that is not cured within 7 days of
          written notice.
        </p>
        <p>
          On termination of the Licence the Customer must immediately stop accessing and
          using the Software, delete or remove any locally cached or downloaded
          components, and on request certify in writing that it has done so. Customer
          Data export rights are governed by clause 8 of the Terms.
        </p>
      </>
    ),
  },
  {
    id: "10-warranty",
    title: "10. Warranty disclaimer",
    body: (
      <p>
        Except as expressly stated in the Terms, the Software is licensed "as is" and
        EnviroIQ disclaims, to the fullest extent permitted by law, all warranties
        whether express, implied or statutory, including warranties of merchantability,
        fitness for a particular purpose, accuracy, and non-infringement. EnviroIQ does
        not warrant that the Software will be uninterrupted, error-free, or that any
        defect will be corrected.
      </p>
    ),
  },
  {
    id: "11-liability",
    title: "11. Liability",
    body: (
      <p>
        Liability for breach of this Licence is governed by clause 13 of the Terms,
        which is incorporated into this Licence by reference.
      </p>
    ),
  },
  {
    id: "12-relationship",
    title: "12. Relationship to the Terms",
    body: (
      <p>
        This Licence is supplemental to, and forms part of, the agreement between the
        Customer and EnviroIQ that comprises the relevant Order Form, the Terms and this
        Licence. Defined terms used but not defined in this Licence have the meanings
        given in the Terms. If there is a conflict, the order of precedence in clause 17
        of the Terms applies.
      </p>
    ),
  },
  {
    id: "13-governing-law",
    title: "13. Governing law",
    body: (
      <p>
        This Licence is governed by the laws of New Zealand. The parties submit to the
        exclusive jurisdiction of the New Zealand courts.
      </p>
    ),
  },
  {
    id: "14-contact",
    title: "14. Contact",
    body: (
      <p>
        Licensing questions can be sent to{" "}
        <a className="text-primary underline" href="mailto:contact@frerkencompanies.com">
          contact@frerkencompanies.com
        </a>
        .
      </p>
    ),
  },
];

export default function License() {
  usePageMeta(PAGE_META.license);
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
                  <KeyRound className="w-3 h-3 mr-2" />
                  Software Licence
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">
                  VERSION {VERSION} · LAST UPDATED {LAST_UPDATED.toUpperCase()}
                </span>
              </motion.div>

              <motion.h1
                variants={fadeIn}
                className="text-4xl md:text-5xl font-bold tracking-tighter mb-6 leading-[1.1]"
              >
                Software Licence Agreement
              </motion.h1>

              <motion.p
                variants={fadeIn}
                className="text-lg text-muted-foreground max-w-3xl leading-relaxed"
              >
                This Licence sets out the rights you receive to use the EnviroIQ
                platform. It works alongside our{" "}
                <a href="/terms" className="text-primary underline">
                  Terms and Conditions
                </a>{" "}
                and your Order Form.
              </motion.p>
            </motion.div>
          </div>
        </section>

        {/* Clauses */}
        <section className="pb-32">
          <div className="container mx-auto px-6">
            <div className="grid lg:grid-cols-[260px_1fr] gap-10 max-w-6xl">
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
