import { motion } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ComplianceWidget } from "@/components/compliance-widget";
import { apiUrl } from "@/lib/api";
import { usePageMeta, PAGE_META } from "@/lib/use-page-meta";
import {
  ShieldCheck, Lock, Fingerprint, KeyRound, Database, FileCheck,
  GitBranch, History, Eye, Download, Server, Globe, AlertCircle,
  CheckCircle2, Layers, FileSearch, ArrowRight, Hash, Clock,
  Users, ScrollText, Zap, Activity,
} from "lucide-react";

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};
const stagger = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
};

export default function Trust() {
  usePageMeta(PAGE_META.trust);
  return (
    <div className="min-h-screen bg-background selection:bg-primary/20">
      <Navbar />

      <main>
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative pt-32 pb-20 md:pt-44 md:pb-24 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
          </div>
          <div className="container mx-auto px-6 relative z-10">
            <motion.div variants={stagger} initial="hidden" animate="show" className="max-w-4xl">
              <motion.div variants={fadeIn} className="mb-6 flex items-center gap-3">
                <Badge variant="outline" className="border-primary/30 text-primary bg-primary/8 px-3 py-1">
                  <ShieldCheck className="w-3 h-3 mr-2" />
                  Trust & Compliance
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">AUDIT-GRADE BY DESIGN</span>
              </motion.div>

              <motion.h1 variants={fadeIn} className="text-5xl md:text-6xl font-bold tracking-tighter mb-8 leading-[1.1]">
                Every ESG number,<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-500">
                  fully traceable from source to output.
                </span>
              </motion.h1>

              <motion.p variants={fadeIn} className="text-xl md:text-2xl text-muted-foreground mb-6 max-w-3xl leading-relaxed">
                EnviroIQ is built for boards, auditors, and regulators — not just dashboards. Every metric carries provenance, every action is logged, every calculation is versioned.
              </motion.p>

              <motion.p variants={fadeIn} className="text-base text-muted-foreground/80 mb-10 max-w-2xl leading-relaxed">
                You don't just get an ESG number. You get the raw data, the emission factor version, the methodology, the transformation chain, and the user who entered it — all in one click.
              </motion.p>

              <motion.div variants={fadeIn} className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-8 text-lg group" asChild>
                  <a href={apiUrl("/api/compliance/public/pack.txt")} download>
                    <Download className="mr-2 w-5 h-5" />
                    Download Trust Pack
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-border" asChild>
                  <a href="#data-trust-model">See the Data Trust Model</a>
                </Button>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mt-12 max-w-4xl"
            >
              <ComplianceWidget />
            </motion.div>
          </div>
        </section>

        {/* ── THE FOUR TRUST PILLARS ───────────────────────────────────────── */}
        <section className="py-24 bg-muted/40 border-y border-border">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <p className="text-sm font-mono text-primary mb-4 tracking-wider">THE FOUR PILLARS</p>
              <h2 className="text-4xl font-bold mb-4">Built on principles, not promises</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
                Four non-negotiable design principles underpin every line of code in the platform.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {[
                { icon: Database, title: "Immutable", desc: "Raw data cannot be modified. All updates create new versions. Complete history is retained forever." },
                { icon: ScrollText, title: "Logged", desc: "Every user action, system change, and data ingestion event is recorded with timestamp, user, IP, and before/after values." },
                { icon: GitBranch, title: "Versioned", desc: "Every emission factor and calculation methodology is stamped with a version and effective date. You can recalculate any historical output." },
                { icon: FileSearch, title: "Traceable", desc: "Every ESG metric links back to its raw source rows, the factor used, and the transformation path. Click a number → see the lineage." },
              ].map((p, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08 }}
                  className="p-6 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all"
                >
                  <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center mb-4">
                    <p.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-foreground mb-2">{p.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{p.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── DATA TRUST MODEL ─────────────────────────────────────────────── */}
        <section id="data-trust-model" className="py-32 bg-background">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <p className="text-sm font-mono text-primary mb-4 tracking-wider">THE DATA TRUST MODEL</p>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">From raw source to board-ready output.</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Every data point flows through five validated stages. Every stage is recorded. Nothing is invisible.
              </p>
            </div>

            <div className="grid lg:grid-cols-5 gap-4 mb-12">
              {[
                { num: "01", icon: Server, title: "Source", desc: "Fuel cards, smart meters, IoT sensors, supplier APIs, manual upload, email ingest." },
                { num: "02", icon: ShieldCheck, title: "Validate", desc: "Schema, range, and integrity checks. Failed rows quarantined with reason." },
                { num: "03", icon: GitBranch, title: "Transform", desc: "Versioned emission factor applied. Calculation method recorded with output." },
                { num: "04", icon: Database, title: "Store", desc: "Append-only writes. Raw payload retained alongside computed values." },
                { num: "05", icon: FileCheck, title: "Output", desc: "Board PDF, dashboard, widget. Every number links back to lineage." },
              ].map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="p-6 rounded-xl bg-primary/5 border border-primary/15 relative"
                >
                  <span className="text-xs font-mono font-bold text-primary opacity-60">{s.num}</span>
                  <div className="my-3 w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center">
                    <s.icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-bold text-foreground mb-2">{s.title}</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
                  {i < 4 && (
                    <div className="hidden lg:block absolute top-1/2 -right-3 -translate-y-1/2 z-10">
                      <ArrowRight className="w-5 h-5 text-primary/50" />
                    </div>
                  )}
                </motion.div>
              ))}
            </div>

            <motion.div
              initial={{ opacity: 0, scale: 0.97 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="p-8 rounded-2xl bg-gradient-to-br from-primary/8 to-emerald-500/5 border border-primary/20"
            >
              <div className="flex items-start gap-4">
                <Eye className="w-6 h-6 text-primary mt-1 shrink-0" />
                <div>
                  <h3 className="text-xl font-bold mb-2">Click-to-lineage on every number</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    Every emissions figure in the dashboard, board PDF, or embeddable widget carries a <span className="font-mono text-primary">[lineage]</span> badge.
                    Click it and you see: the raw source rows, the emission factor version that was applied, the calculation timestamp, and the user who triggered the ingest.
                    No more "trust the dashboard" — verify it yourself.
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        </section>

        {/* ── SECURITY ─────────────────────────────────────────────────────── */}
        <section className="py-24 bg-muted/40 border-y border-border">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-16 items-start">
              <div>
                <p className="text-sm font-mono text-primary mb-4 tracking-wider">SECURITY</p>
                <h2 className="text-4xl font-bold mb-6">Enterprise-grade by default.</h2>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                  Security isn't a paid add-on. Every customer — from a 50-person plumbing firm to a $500M corporate — gets the same posture from day one.
                </p>
                <div className="p-6 rounded-xl bg-card border border-border">
                  <div className="flex items-center gap-3 mb-3">
                    <Globe className="w-5 h-5 text-primary" />
                    <h4 className="font-bold">NZ Sovereign Data Hosting · Coming Soon</h4>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Auckland-region hosting on AWS ap-southeast-2 (Sydney) with NZ-resident failover is on our 2026 roadmap. Until then, infrastructure is hosted in geographically redundant cloud regions, encrypted at rest and in transit. Customers requiring strict NZ data residency today can opt into a private deployment — talk to us.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  { icon: Lock, t: "Encryption at rest & in transit", d: "AES-256 at rest, TLS 1.3 in transit. Database connections require SSL." },
                  { icon: Fingerprint, t: "Passwordless authentication", d: "WebAuthn / passkeys via Face ID, Touch ID, Windows Hello. No passwords to steal." },
                  { icon: Users, t: "Role-based access control", d: "Super Admin, Org Admin, Org User, Org Auditor (read-only). Tenant isolation at the query layer." },
                  { icon: KeyRound, t: "MFA enforcement (org-level toggle)", d: "Org admins can require MFA for every member of their organisation." },
                  { icon: Server, t: "Tenant isolation", d: "Every query is scoped by organisation_id at the application and database layer. No cross-tenant data leakage possible." },
                  { icon: AlertCircle, t: "Failed-action logging", d: "Authentication failures, permission denials, and rate-limit trips are all written to the immutable audit log." },
                ].map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: 20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05 }}
                    className="p-5 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
                  >
                    <div className="flex items-start gap-4">
                      <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                        <item.icon className="w-4 h-4 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-foreground mb-1">{item.t}</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">{item.d}</p>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── COMPLIANCE ROADMAP ───────────────────────────────────────────── */}
        <section className="py-32 bg-background">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <p className="text-sm font-mono text-primary mb-4 tracking-wider">COMPLIANCE ROADMAP</p>
              <h2 className="text-4xl md:text-5xl font-bold mb-6">Built for SOC 2, ISO 27001, and beyond.</h2>
              <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
                Compliance is a journey, not a checkbox. Here's exactly where we are and where we're heading.
              </p>
            </div>

            <div className="max-w-4xl mx-auto space-y-4">
              {[
                { status: "live", icon: CheckCircle2, title: "Immutable audit logging", desc: "Every create, update, delete, login, and data ingestion event is logged to an append-only table with user, timestamp, IP, user-agent, and before/after values.", tag: "LIVE NOW" },
                { status: "live", icon: CheckCircle2, title: "Versioned calculations", desc: "Emission factors are stored as versioned records with effective dates. Recalculations preserve which factor version was applied to each historical metric.", tag: "LIVE NOW" },
                { status: "live", icon: CheckCircle2, title: "Data lineage tracking", desc: "Every ESG metric links to its source data rows, emission factor version, ingest batch ID, and the user who triggered ingestion.", tag: "LIVE NOW" },
                { status: "live", icon: CheckCircle2, title: "RBAC + tenant isolation", desc: "Four roles: Super Admin, Org Admin, Org User, Org Auditor. All queries are organisation-scoped at the database layer.", tag: "LIVE NOW" },
                { status: "live", icon: CheckCircle2, title: "Passwordless / WebAuthn auth", desc: "Passkey-based authentication via device biometrics. Magic-link fallback for new device enrollment.", tag: "LIVE NOW" },
                { status: "progress", icon: Clock, title: "SOC 2 Type I", desc: "Audit-ready evidence pack export, control mappings, and policy documentation in active development. Target: H1 2026.", tag: "IN PROGRESS" },
                { status: "progress", icon: Clock, title: "ISO 27001 alignment", desc: "Information security management system controls being mapped against the platform. Target: H2 2026.", tag: "IN PROGRESS" },
                { status: "progress", icon: Clock, title: "MFA enforcement (org toggle)", desc: "Org admins will be able to require MFA for every user in their organisation. Currently passkey-optional.", tag: "Q2 2026" },
                { status: "planned", icon: Activity, title: "SOC 2 Type II", desc: "Continuous monitoring period and external auditor attestation. Target: H2 2026.", tag: "PLANNED" },
                { status: "planned", icon: Activity, title: "GDPR + NZ Privacy Act 2020 attestation", desc: "Data processor agreement template, sub-processor list, and breach notification procedures formalised.", tag: "PLANNED" },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  className={`p-5 rounded-xl border flex items-start gap-4 ${
                    item.status === "live"
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : item.status === "progress"
                      ? "bg-primary/5 border-primary/20"
                      : "bg-card border-border"
                  }`}
                >
                  <item.icon className={`w-5 h-5 mt-1 shrink-0 ${
                    item.status === "live" ? "text-emerald-500" : item.status === "progress" ? "text-primary" : "text-muted-foreground"
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <h4 className="font-bold text-foreground">{item.title}</h4>
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${
                        item.status === "live"
                          ? "bg-emerald-500/15 text-emerald-600"
                          : item.status === "progress"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}>{item.tag}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── COMPLIANCE EVIDENCE PACK ─────────────────────────────────────── */}
        <section className="py-24 bg-[#0f172a] text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.12)_0%,transparent_60%)]" />
          <div className="container mx-auto px-6 relative z-10">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <div>
                <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm font-mono text-green-400 mb-6">
                  <Download className="w-3.5 h-3.5" />
                  One-click compliance evidence
                </div>
                <h2 className="text-4xl font-bold mb-6 leading-tight">
                  Export an auditor-ready evidence pack<br />
                  <span className="text-green-400">in seconds.</span>
                </h2>
                <p className="text-lg text-slate-400 mb-8 leading-relaxed">
                  Pick a date range. Click export. Get a cryptographically-hashed ZIP containing every audit log entry, every fleet event with the emission factor version applied, every energy reading, and a manifest with SHA-256 hashes of every file.
                </p>
                <ul className="space-y-3 text-slate-300">
                  {[
                    "audit_logs.csv — every action with user, IP, timestamp, before/after",
                    "fleet_events.csv — every refuel + the factor version applied",
                    "energy_readings.csv — every kWh + the grid intensity used",
                    "emission_factors_used.csv — full provenance of every factor",
                    "manifest.json — generated_by, period, SHA-256 hash of every file",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Hash className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
                      <span className="text-sm">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-6 font-mono text-xs overflow-hidden shadow-2xl">
                <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                  <span className="text-slate-500 text-[10px] ml-2">enviroiq-evidence-2026Q1.zip</span>
                </div>
                <div className="space-y-1 text-slate-300">
                  <div><span className="text-slate-500">📦</span> enviroiq-evidence-2026Q1.zip</div>
                  <div className="ml-3"><span className="text-green-400">├─</span> manifest.json <span className="text-slate-500 ml-2">(SHA-256 hashes)</span></div>
                  <div className="ml-3"><span className="text-green-400">├─</span> audit_logs.csv <span className="text-slate-500 ml-2">2,847 rows</span></div>
                  <div className="ml-3"><span className="text-green-400">├─</span> fleet_events.csv <span className="text-slate-500 ml-2">932 rows</span></div>
                  <div className="ml-3"><span className="text-green-400">├─</span> energy_readings.csv <span className="text-slate-500 ml-2">36 rows</span></div>
                  <div className="ml-3"><span className="text-green-400">└─</span> emission_factors_used.csv <span className="text-slate-500 ml-2">12 versions</span></div>
                  <div className="mt-4 pt-3 border-t border-white/10 text-slate-500">
                    <div>generated_by: ulrich@edgeops.nz</div>
                    <div>period: 2026-01-01 → 2026-03-31</div>
                    <div>org: acme-plumbing</div>
                    <div className="text-green-400 mt-2">✓ All files validated</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────────── */}
        <section className="py-32 bg-background">
          <div className="container mx-auto px-6 max-w-4xl">
            <div className="text-center mb-16">
              <p className="text-sm font-mono text-primary mb-4 tracking-wider">FREQUENTLY ASKED</p>
              <h2 className="text-4xl font-bold mb-4">Procurement-grade questions, answered straight.</h2>
            </div>

            <div className="space-y-4">
              {[
                { q: "Where is customer data stored?", a: "All customer data resides on infrastructure within New Zealand. PostgreSQL with daily snapshots and point-in-time recovery. No cross-border replication unless explicitly configured." },
                { q: "Can I delete my data?", a: "Yes. On request we'll permanently delete all customer-identifiable data within 30 days. Audit log entries reference user IDs (not personal details) so the audit chain remains intact for regulatory purposes." },
                { q: "What happens if you change an emission factor?", a: "Nothing to historical data. Factors are versioned records with effective dates. New ingests use the current factor; historical metrics retain the factor version that was applied at the time. Recalculation is opt-in and creates a new metric version, not an overwrite." },
                { q: "Can my auditor get read-only access?", a: "Yes. The Org Auditor role is read-only across all organisation data plus the audit log. Auditors can view, filter, and export but cannot modify, delete, or trigger ingests." },
                { q: "How do I prove a number to my board?", a: "Click any ESG figure. You see the raw source rows, the emission factor version applied, the calculation timestamp, and the ingest batch ID. Or export the full evidence pack as a ZIP." },
                { q: "Are you SOC 2 certified?", a: "SOC 2 Type I is in active preparation, target H1 2026. The platform is built to SOC 2 controls today (immutable audit log, RBAC, encryption, change management). Type II attestation follows in H2 2026." },
                { q: "What's your incident response process?", a: "Detected within minutes via runtime monitoring. Customer notification within 24 hours of confirmed breach affecting their data. Full post-incident report within 14 days." },
                { q: "Do you have a security pack for procurement?", a: "Yes — request it via contact@frerkencompanies.com. Includes architecture diagram, data flow, control mapping, sub-processor list, and SOC 2 readiness summary." },
              ].map((item, i) => (
                <motion.details
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.04 }}
                  className="group p-6 rounded-xl bg-card border border-border hover:border-primary/30 transition-all"
                >
                  <summary className="flex items-center justify-between cursor-pointer list-none">
                    <h4 className="font-semibold text-foreground pr-4">{item.q}</h4>
                    <span className="text-primary text-2xl group-open:rotate-45 transition-transform shrink-0">+</span>
                  </summary>
                  <p className="text-sm text-muted-foreground leading-relaxed mt-4">{item.a}</p>
                </motion.details>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ──────────────────────────────────────────────────────────── */}
        <section className="py-24 bg-muted/40 border-t border-border">
          <div className="container mx-auto px-6 text-center max-w-3xl">
            <h2 className="text-4xl font-bold mb-6">Need our security pack?</h2>
            <p className="text-lg text-muted-foreground mb-10">
              Architecture diagram, data flow, control mapping, sub-processor list, and SOC 2 readiness summary — for your procurement team.
            </p>
            <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-8 text-lg" asChild>
              <a href="mailto:contact@frerkencompanies.com?subject=EnviroIQ%20Security%20Review">
                Request Security Pack
                <ArrowRight className="ml-2 w-5 h-5" />
              </a>
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
