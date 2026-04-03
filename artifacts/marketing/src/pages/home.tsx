import { motion } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Activity, Eye, FileCheck, LayoutDashboard, Zap, Truck,
  Building2, Leaf, ShieldCheck, Users, BookOpen, Scale, BarChart3,
  Fingerprint, Globe, Sparkles, Lock, Database, ChevronRight, TrendingDown,
  ClipboardList, PieChart, FileText, Bolt, Recycle, Droplets, HardHat,
  FolderOpen, Package, CheckSquare, Award
} from "lucide-react";
import { Badge } from "@/components/ui/badge";

const staggerContainer = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } }
};

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } }
};

export default function Home() {
  return (
    <div className="min-h-screen bg-background selection:bg-primary/20">
      <Navbar />

      <main>
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/8 rounded-full blur-[120px] opacity-60 pointer-events-none" />
          </div>

          <div className="container mx-auto px-6 relative z-10">
            <motion.div variants={staggerContainer} initial="hidden" animate="show" className="max-w-4xl">
              <motion.div variants={fadeIn} className="mb-6 flex items-center gap-3">
                <Badge variant="outline" className="border-primary/30 text-primary bg-primary/8 px-3 py-1">
                  <Activity className="w-3 h-3 mr-2" />
                  Full E + S + G Coverage
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">PLATFORM: LIVE</span>
              </motion.div>

              <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl font-bold tracking-tighter mb-8 leading-[1.1]">
                EnviroIQ:<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-500">
                  Real-Time ESG Intelligence
                </span>
              </motion.h1>

              <motion.p variants={fadeIn} className="text-xl md:text-2xl text-muted-foreground mb-6 max-w-3xl leading-relaxed">
                The complete ESG platform for New Zealand organisations — covering Environment, Social, and Governance in one unified system.
              </motion.p>

              <motion.p variants={fadeIn} className="text-lg text-muted-foreground/80 mb-10 max-w-2xl leading-relaxed">
                Fleet emissions, energy tracking, workforce reporting, board-ready PDF packs, NZ real-time grid data, AI-generated narratives, and full audit logging — all in one platform.
              </motion.p>

              <motion.div variants={fadeIn} className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-8 text-lg group" asChild>
                  <a href="mailto:hello@enviroiq.net">
                    Request a Demo
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-border hover:bg-muted" asChild>
                  <a href="#features">Explore Features</a>
                </Button>
              </motion.div>
            </motion.div>

            {/* Pillar badges */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.5 }}
              className="mt-16 flex flex-wrap gap-4"
            >
              {[
                { label: "Environmental", sub: "Fleet · Energy · Grid Intensity", color: "bg-emerald-50 border-emerald-200 text-emerald-800" },
                { label: "Social", sub: "Workforce · H&S · Training", color: "bg-blue-50 border-blue-200 text-blue-800" },
                { label: "Governance", sub: "Board · Policy · Frameworks", color: "bg-purple-50 border-purple-200 text-purple-800" },
              ].map((p, i) => (
                <div key={i} className={`px-5 py-3 rounded-xl border text-sm font-semibold ${p.color}`}>
                  {p.label}
                  <span className="block font-normal opacity-75 text-xs mt-0.5">{p.sub}</span>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="mt-16 relative rounded-2xl border border-border bg-card overflow-hidden shadow-xl"
            >
              <img
                src={`${import.meta.env.BASE_URL}images/hero-data.png`}
                alt="EnviroIQ Dashboard Visualization"
                className="w-full h-auto object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />
            </motion.div>
          </div>
        </section>

        {/* ── THE PROBLEM ──────────────────────────────────────────────────── */}
        <section id="problem" className="py-24 bg-muted/50 border-y border-border">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial="hidden" whileInView="show" viewport={{ once: true, margin: "-100px" }}
                variants={staggerContainer}
              >
                <motion.h2 variants={fadeIn} className="text-4xl font-bold mb-6">
                  ESG today is <span className="text-destructive">broken.</span>
                </motion.h2>
                <ul className="space-y-6 mb-10">
                  {[
                    "Reports are 30–90 days behind reality",
                    "Social and Governance data sits in spreadsheets",
                    "Decisions are made on averages, not truth",
                    "Compliance is manual, expensive, and reactive",
                    "Board packs take weeks to compile"
                  ].map((item, i) => (
                    <motion.li variants={fadeIn} key={i} className="flex items-start gap-4">
                      <div className="w-1.5 h-1.5 rounded-full bg-destructive mt-2.5 shrink-0" />
                      <span className="text-xl text-muted-foreground">{item}</span>
                    </motion.li>
                  ))}
                </ul>
                <motion.div variants={fadeIn} className="p-6 rounded-xl bg-destructive/8 border border-destructive/20 inline-block">
                  <p className="text-xl font-medium text-destructive font-mono">
                    "You can't optimise what you can't see in real time."
                  </p>
                </motion.div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="relative rounded-2xl border border-border bg-white shadow-md flex flex-col justify-center p-10"
              >
                <div className="space-y-8">
                  {[
                    { label: "Data Collection", q: "Q1", op: "opacity-40" },
                    { label: "Spreadsheet Aggregation", q: "Q2", op: "opacity-60" },
                    { label: "Decisions Made (Too Late)", q: "Q3", op: "text-destructive" }
                  ].map((item, i) => (
                    <div key={i} className={`flex items-center gap-4 ${item.op}`}>
                      <div className={`w-12 h-12 rounded-full border flex items-center justify-center ${item.op === "text-destructive" ? "border-destructive bg-destructive/10 text-destructive" : "border-dashed border-gray-300"}`}>
                        <span className="text-xs font-bold">{item.q}</span>
                      </div>
                      <div className={`h-px flex-1 ${item.op === "text-destructive" ? "bg-destructive" : "bg-gray-200"}`} />
                      <div className={`text-sm font-mono text-center ${item.op === "text-destructive" ? "font-bold text-destructive" : "text-muted-foreground"}`}>{item.label}</div>
                    </div>
                  ))}
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── FULL FEATURE GRID ─────────────────────────────────────────────── */}
        <section id="features" className="py-32 bg-background">
          <div className="container mx-auto px-6">
            <div className="text-center mb-20">
              <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-sm font-mono text-primary mb-4 tracking-wider">PLATFORM CAPABILITIES</motion.p>
              <motion.h2 initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="text-4xl md:text-5xl font-bold mb-6">
                Everything. One platform.
              </motion.h2>
              <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Built specifically for New Zealand organisations who need a complete, audit-ready ESG system today.
              </motion.p>
            </div>

            {/* ── Environmental ── */}
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <Leaf className="w-5 h-5 text-emerald-700" />
                </div>
                <h3 className="text-2xl font-bold text-foreground">Environmental</h3>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[
                  {
                    icon: Truck,
                    title: "Fleet & Scope 1 Emissions",
                    desc: "Automatic per-vehicle CO₂e calculations using NZ MfE 2024 emission factors. Supports diesel, petrol, hybrid, PHEV, and EV. Fuelsaver plate lookup for accurate vehicle class identification.",
                    badge: "NZ MfE 2024"
                  },
                  {
                    icon: Bolt,
                    title: "Energy & Scope 2 Emissions",
                    desc: "Track electricity and gas consumption with live NZ grid intensity data from the Electricity Authority em6 API. Automatic Scope 2 calculations using real-time carbon intensity.",
                    badge: "em6 Real-Time"
                  },
                  {
                    icon: BarChart3,
                    title: "Year-on-Year Trend Analysis",
                    desc: "24-month rolling trend charts with Q1/Q2/Q3/Q4/H1/H2 period selection. Stacked bar charts comparing fleet vs energy. Automatic partial-month exclusion for clean data.",
                    badge: "24-Month History"
                  },
                  {
                    icon: TrendingDown,
                    title: "Emission Targets & Goals",
                    desc: "Set reduction targets per emissions category. Track on-track, at-risk, and behind-schedule goals. Goals appear in the board PDF and executive summary.",
                    badge: "Target Tracking"
                  },
                  {
                    icon: Globe,
                    title: "Embeddable Public Widget",
                    desc: "Embed a real-time sustainability dashboard directly on your company website. Show customers your live ESG score and emissions data — no login required.",
                    badge: "Public API"
                  },
                  {
                    icon: PieChart,
                    title: "ESG Maturity Score",
                    desc: "Composite 0–100 sustainability score from data completeness, goal progress, and emissions intensity. Colour-coded rating from Critical Risk to Excellent.",
                    badge: "Live Score"
                  },
                ].map((f, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.07 }}
                    className="p-6 rounded-2xl bg-emerald-50 border border-emerald-100 hover:border-emerald-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-2.5 rounded-xl bg-emerald-100">
                        <f.icon className="w-5 h-5 text-emerald-700" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">{f.badge}</span>
                    </div>
                    <h4 className="font-bold text-foreground mb-2">{f.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* ── Social ── */}
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <Users className="w-5 h-5 text-blue-700" />
                </div>
                <h3 className="text-2xl font-bold text-foreground">Social</h3>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[
                  {
                    icon: Users,
                    title: "Workforce Diversity Snapshots",
                    desc: "Track headcount, gender diversity ratios, part-time vs full-time split, Māori and Pasifika representation, and employee engagement scores over time.",
                    badge: "Annual Snapshots"
                  },
                  {
                    icon: ShieldCheck,
                    title: "Health & Safety Incidents",
                    desc: "Log TRIFR, near-misses, lost time injuries, and fatalities. Full incident register with severity classification, investigation notes, and trend tracking.",
                    badge: "H&S Register"
                  },
                  {
                    icon: BookOpen,
                    title: "Training & Development",
                    desc: "Record mandatory training completions, hours per employee, and certification status. Track training investment and coverage rates across the workforce.",
                    badge: "Training Records"
                  },
                  {
                    icon: ClipboardList,
                    title: "Social Summary Dashboard",
                    desc: "Board-ready social metrics at a glance — headcount trends, incident rates, training coverage, and key social KPIs with historical comparisons.",
                    badge: "Board-Ready"
                  },
                  {
                    icon: Activity,
                    title: "Trend Reporting",
                    desc: "Year-on-year comparisons for TRIFR, workforce diversity, and training investment. Social data included in the board PDF pack executive summary.",
                    badge: "YoY Analysis"
                  },
                  {
                    icon: Sparkles,
                    title: "AI Mission Statement",
                    desc: "AI-powered ESG mission statement generator. Creates a concise, professional sustainability statement from your actual ESG data — unique to your organisation.",
                    badge: "AI-Assisted"
                  },
                ].map((f, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.07 }}
                    className="p-6 rounded-2xl bg-blue-50 border border-blue-100 hover:border-blue-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-2.5 rounded-xl bg-blue-100">
                        <f.icon className="w-5 h-5 text-blue-700" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-100 px-2 py-1 rounded-full">{f.badge}</span>
                    </div>
                    <h4 className="font-bold text-foreground mb-2">{f.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* ── Governance ── */}
            <div>
              <div className="flex items-center gap-3 mb-8">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Scale className="w-5 h-5 text-purple-700" />
                </div>
                <h3 className="text-2xl font-bold text-foreground">Governance</h3>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {[
                  {
                    icon: Scale,
                    title: "Board Composition Tracking",
                    desc: "Record board size, gender diversity, independent directors, Māori representation, and average tenure. Track governance composition year over year.",
                    badge: "Board Data"
                  },
                  {
                    icon: FileCheck,
                    title: "Policy & Framework Alignment",
                    desc: "Manage your policy checklist across ESG, climate, H&S, privacy, supply chain, whistleblower, and more. Progress bar shows overall policy coverage with per-policy dates.",
                    badge: "Policy Checklist"
                  },
                  {
                    icon: Database,
                    title: "Framework Alignment",
                    desc: "Track alignment to NZ Climate Disclosure, GRI Standards, UN SDGs, TCFD, Toitū CEMARS, and GHG Protocol. Visual indicators for each framework's status.",
                    badge: "NZ Standards"
                  },
                  {
                    icon: FileText,
                    title: "Board PDF Pack",
                    desc: "Professional 5-page board report with dark navy cover, executive dashboard, AI-generated narrative, Scope 1 fleet analysis, Scope 2 energy breakdown, and methodology. Generated on demand.",
                    badge: "5-Page PDF"
                  },
                  {
                    icon: Lock,
                    title: "Full Audit Logging",
                    desc: "Immutable audit trail for every data change, login, and report download. Role-based access control with Super Admin, Admin, Manager, and Viewer roles per organisation.",
                    badge: "RBAC + Audit"
                  },
                  {
                    icon: Fingerprint,
                    title: "Passkey / WebAuthn Auth",
                    desc: "Passwordless authentication via device biometrics (Face ID, Touch ID, Windows Hello). No passwords to steal, no resets to manage — enterprise-grade security by default.",
                    badge: "Passwordless"
                  },
                ].map((f, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.07 }}
                    className="p-6 rounded-2xl bg-purple-50 border border-purple-100 hover:border-purple-300 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="p-2.5 rounded-xl bg-purple-100">
                        <f.icon className="w-5 h-5 text-purple-700" />
                      </div>
                      <span className="text-[10px] font-mono font-bold text-purple-700 bg-purple-100 px-2 py-1 rounded-full">{f.badge}</span>
                    </div>
                    <h4 className="font-bold text-foreground mb-2">{f.title}</h4>
                    <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── BOARD PDF HIGHLIGHT ──────────────────────────────────────────── */}
        <section className="py-24 bg-[#0f172a] text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.12)_0%,transparent_60%)]" />
          <div className="container mx-auto px-6 relative z-10">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial="hidden" whileInView="show" viewport={{ once: true }}
                variants={staggerContainer}
              >
                <motion.div variants={fadeIn} className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-full px-4 py-1.5 text-sm font-mono text-green-400 mb-6">
                  <FileText className="w-3.5 h-3.5" />
                  Board-Ready PDF Reports
                </motion.div>
                <motion.h2 variants={fadeIn} className="text-4xl font-bold mb-6 leading-tight">
                  Professional board packs.<br />
                  <span className="text-green-400">Generated in seconds.</span>
                </motion.h2>
                <motion.p variants={fadeIn} className="text-lg text-slate-400 mb-8 leading-relaxed">
                  Stop spending weeks compiling board reports. EnviroIQ generates a complete 5-page ESG board pack on demand — with AI-written executive narrative, score interpretation, and full methodology.
                </motion.p>
                <motion.ul variants={staggerContainer} className="space-y-4">
                  {[
                    "Dark navy cover page with company name and report period",
                    "Executive dashboard — KPI cards, scope split, YoY comparison",
                    "AI-generated narrative — strengths, risks, recommended actions",
                    "Scope 1 fleet analysis with top emitter bar charts",
                    "Scope 2 energy breakdown and monthly data table",
                    "NZ MfE methodology and GHG Protocol framework alignment",
                  ].map((item, i) => (
                    <motion.li key={i} variants={fadeIn} className="flex items-center gap-3 text-slate-300">
                      <ChevronRight className="w-4 h-4 text-green-400 shrink-0" />
                      {item}
                    </motion.li>
                  ))}
                </motion.ul>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: 30 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8 }}
                className="space-y-4"
              >
                {/* Simulated PDF pages */}
                {[
                  { label: "Cover Page", bg: "bg-[#0f172a] border-slate-700", text: "text-white", preview: "ESG Board Pack · Dark navy with company branding" },
                  { label: "Executive Dashboard", bg: "bg-white border-slate-200", text: "text-slate-800", preview: "KPI tiles · Scope split · YoY comparison" },
                  { label: "AI Executive Summary", bg: "bg-white border-slate-200", text: "text-slate-800", preview: "Strengths · Risks · Recommended Actions" },
                  { label: "Fleet & Energy Analysis", bg: "bg-white border-slate-200", text: "text-slate-800", preview: "Progress bars · Emitter charts · Monthly table" },
                  { label: "Methodology", bg: "bg-white border-slate-200", text: "text-slate-800", preview: "NZ MfE 2024 · GHG Protocol · Toitū CEMARS" },
                ].map((page, i) => (
                  <div key={i} className={`rounded-lg border p-4 ${page.bg} flex items-center justify-between`} style={{ transform: `translateX(${i * 4}px)`, opacity: 1 - i * 0.08 }}>
                    <div>
                      <div className={`text-xs font-mono font-bold mb-0.5 ${i === 0 ? "text-green-400" : "text-slate-500"}`}>PAGE {i + 1}</div>
                      <div className={`font-semibold text-sm ${page.text}`}>{page.label}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{page.preview}</div>
                    </div>
                    <div className={`text-xs font-mono px-2 py-1 rounded ${i === 0 ? "bg-green-400/20 text-green-400" : "bg-slate-100 text-slate-500"}`}>
                      {i + 1} of 5
                    </div>
                  </div>
                ))}
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
        <section id="how-it-works" className="py-24 bg-muted/50 border-y border-border">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">Connects directly into live systems</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                No more chasing spreadsheets. Real-time data flows directly into your ESG record.
              </p>
            </div>

            <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
              <div className="flex-1 space-y-3 w-full">
                {[
                  "NZ em6 real-time grid intensity API",
                  "Fuelsaver NZ plate lookup system",
                  "Fleet GPS & vehicle telematics",
                  "Energy meters & utility bills",
                  "HR systems & payroll data",
                  "H&S incident register",
                  "Solar & generation systems",
                ].map((item, i) => (
                  <div key={i} className="px-5 py-3.5 rounded-xl bg-white border border-border text-sm font-mono text-muted-foreground flex items-center shadow-sm">
                    <div className="w-2 h-2 rounded-full bg-primary/60 mr-4 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              <div className="shrink-0 relative">
                <div className="w-32 h-32 rounded-full bg-primary/10 border-4 border-primary flex items-center justify-center shadow-[0_0_40px_rgba(34,197,94,0.20)] z-10 relative">
                  <Leaf className="w-12 h-12 text-primary" />
                </div>
                <div className="hidden lg:block absolute top-1/2 -left-12 w-12 h-px bg-primary/40" />
                <div className="hidden lg:block absolute top-1/2 -right-12 w-12 h-px bg-primary/40" />
              </div>

              <div className="flex-1 space-y-3 w-full">
                {[
                  "Scope 1 fleet CO₂e — live & auditable",
                  "Scope 2 energy CO₂e — real-time grid intensity",
                  "Social KPIs — workforce, H&S, training",
                  "Governance score — board, policy, frameworks",
                  "Composite ESG score — 0 to 100",
                  "5-page AI board pack — on demand",
                  "Embeddable public sustainability widget",
                ].map((item, i) => (
                  <div key={i} className="px-5 py-3.5 rounded-xl bg-primary/5 border border-primary/20 text-sm font-mono text-foreground flex items-center shadow-sm">
                    <ArrowRight className="w-4 h-4 text-primary mr-4 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── VALUE PILLARS ────────────────────────────────────────────────── */}
        <section className="py-32 bg-background">
          <div className="container mx-auto px-6">
            <div className="text-center mb-20">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 text-foreground">Value Pillars</h2>
              <p className="text-xl text-muted-foreground">From compliance to control.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {[
                {
                  title: "See Everything",
                  desc: "Single unified view across Environmental, Social, and Governance pillars. Fleet, energy, workforce, H&S, board — all in one platform, all in real time.",
                  icon: Eye,
                  metric: "Full E+S+G"
                },
                {
                  title: "Act in Real Time",
                  desc: "Live NZ grid intensity, Fuelsaver plate lookup, and per-vehicle emission tracking. Identify inefficiencies today — not next quarter.",
                  icon: Activity,
                  metric: "Live Data"
                },
                {
                  title: "Prove It",
                  desc: "Automatically generate compliant, audit-ready board packs. Full NZ MfE 2024 methodology, GHG Protocol alignment, and Toitū CEMARS readiness.",
                  icon: FileCheck,
                  metric: "Audit-Ready"
                },
                {
                  title: "Show It",
                  desc: "Embed your live ESG score on your website. Passkey auth, per-org branded portals, and public-facing dashboards turn ESG into a competitive advantage.",
                  icon: LayoutDashboard,
                  metric: "Public Widget"
                }
              ].map((pillar, i) => (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  key={i}
                  className="p-10 rounded-3xl bg-white border border-border hover:border-primary/30 hover:shadow-md transition-all group shadow-sm"
                >
                  <div className="flex justify-between items-start mb-8">
                    <div className="p-4 rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform">
                      <pillar.icon className="w-8 h-8" />
                    </div>
                    <span className="font-mono text-sm text-primary/80 font-medium">{pillar.metric}</span>
                  </div>
                  <h3 className="text-2xl font-bold mb-4 text-foreground">{pillar.title}</h3>
                  <p className="text-muted-foreground text-lg leading-relaxed">{pillar.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── USE CASES ────────────────────────────────────────────────────── */}
        <section id="use-cases" className="py-32 bg-muted/50 border-y border-border">
          <div className="container mx-auto px-6">
            <h2 className="text-4xl md:text-5xl font-bold mb-4 text-center text-foreground">Built for Operations</h2>
            <p className="text-xl text-muted-foreground text-center mb-16 max-w-2xl mx-auto">
              EnviroIQ is purpose-built for New Zealand organisations with real-world operational emissions.
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  title: "Fleet & Trade Services",
                  desc: "Full Scope 1 fleet tracking with Fuelsaver plate lookup. Per-vehicle CO₂e, top emitter analysis, and fuel import from CSV. Built for plumbing, electrical, and civil contractors.",
                  icon: Truck
                },
                {
                  title: "Commercial Buildings",
                  desc: "Monitor electricity and gas consumption with real-time NZ grid intensity. Board-ready energy reports with monthly breakdowns and Scope 2 methodology.",
                  icon: Building2
                },
                {
                  title: "Construction & Civil",
                  desc: "Live site emissions tracking across fleet and plant. H&S incident register, workforce diversity, and governance checklists for NZX and government contract compliance.",
                  icon: Zap
                },
                {
                  title: "Professional Services",
                  desc: "Lightweight E+S+G reporting for office-based organisations. AI-generated mission statements, governance policy tracking, and board pack generation for AGM reporting.",
                  icon: LayoutDashboard
                }
              ].map((uc, i) => (
                <div key={i} className="p-8 rounded-2xl border border-border bg-white shadow-sm hover:shadow-md hover:border-primary/30 transition-all flex flex-col">
                  <div className="p-3 rounded-xl bg-primary/10 w-fit mb-6">
                    <uc.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-foreground">{uc.title}</h3>
                  <p className="text-muted-foreground flex-1 text-sm leading-relaxed">{uc.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── NZ GOVERNMENT PROCUREMENT ────────────────────────────────────── */}
        <section id="procurement" className="py-32 bg-slate-950 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.12),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_left,rgba(59,130,246,0.08),transparent_60%)]" />
          <div className="container mx-auto px-6 relative z-10">

            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="text-center mb-6"
            >
              <motion.div variants={fadeIn} className="flex justify-center mb-6">
                <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm font-semibold font-mono">
                  <Award className="w-3.5 h-3.5" />
                  NZ GOVERNMENT PROCUREMENT
                </span>
              </motion.div>
              <motion.h2 variants={fadeIn} className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
                Win government contracts.<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-cyan-400">
                  Prove your credentials in minutes.
                </span>
              </motion.h2>
              <motion.p variants={fadeIn} className="text-xl text-slate-400 max-w-3xl mx-auto leading-relaxed">
                EnviroIQ includes purpose-built modules for NZ government and local council procurement. Track every sustainability proof-point demanded in modern tender specifications — from Scope 1 emissions to subcontractor H&S inductions.
              </motion.p>
            </motion.div>

            {/* Tender Pack CTA bar */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20 p-6 rounded-2xl bg-emerald-500/8 border border-emerald-500/20"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <FileText className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <div className="font-bold text-white">Tender Evidence Pack</div>
                  <div className="text-sm text-slate-400">One-click export: print-ready PDF covering all 6 NZ procurement proof points</div>
                </div>
              </div>
              <div className="sm:ml-auto flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                <CheckSquare className="w-4 h-4" />
                Generated on demand · Board-ready · Audit-traceable
              </div>
            </motion.div>

            {/* 6 proof-point cards */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
              {[
                {
                  icon: Leaf,
                  color: "emerald",
                  label: "Proof Point 1",
                  title: "Carbon & Emissions",
                  desc: "Scope 1 fleet CO₂e and Scope 2 energy CO₂e tracked against per-project targets. Real-time NZ grid intensity. GHG Protocol aligned, NZ MfE 2024 emission factors.",
                  tags: ["Fleet CO₂e", "Energy CO₂e", "Reduction targets"],
                },
                {
                  icon: Recycle,
                  color: "teal",
                  label: "Proof Point 2",
                  title: "Waste & Environmental",
                  desc: "Waste generated vs diverted, monthly water consumption tracking, and a full environmental incident register. Site-level breakdown for multi-project contractors.",
                  tags: ["Waste diversion %", "Water use", "Incident register"],
                },
                {
                  icon: HardHat,
                  color: "amber",
                  label: "Proof Point 3",
                  title: "Health & Safety",
                  desc: "LTIFR trends, H&S training hours, near-miss and incident logging. First aid and HSR records with date tracking. Meets WorkSafe NZ reporting expectations.",
                  tags: ["LTIFR", "Training hours", "Incident log"],
                },
                {
                  icon: Users,
                  color: "blue",
                  label: "Proof Point 4",
                  title: "Workforce & Social",
                  desc: "Gender diversity, living wage alignment, local spend %, apprentice and trainee headcount. Social KPIs aligned to NZ government supplier diversity expectations.",
                  tags: ["Diversity %", "Local spend", "Living wage"],
                },
                {
                  icon: Scale,
                  color: "purple",
                  label: "Proof Point 5",
                  title: "Governance",
                  desc: "Board composition, ESG frameworks adopted (ISO 14001, Toitū CEMARS, B Corp), policy registers, and a composite 0–100 governance maturity score.",
                  tags: ["ISO 14001", "Toitū CEMARS", "Policy register"],
                },
                {
                  icon: Package,
                  color: "rose",
                  label: "Proof Point 6",
                  title: "Supply Chain",
                  desc: "Subcontractor H&S compliance tracker — induction dates, training records, compliance status, and expiry alerts. Evidence-ready for principal contractor obligations.",
                  tags: ["Induction records", "Compliance %", "Expiry alerts"],
                },
              ].map((card, i) => {
                const colorMap: Record<string, { bg: string; border: string; tag: string; icon: string; label: string }> = {
                  emerald: { bg: "bg-emerald-500/10", border: "border-emerald-500/25 hover:border-emerald-400/50", tag: "bg-emerald-500/15 text-emerald-300", icon: "text-emerald-400", label: "text-emerald-500/70" },
                  teal:    { bg: "bg-teal-500/10",    border: "border-teal-500/25 hover:border-teal-400/50",    tag: "bg-teal-500/15 text-teal-300",    icon: "text-teal-400",    label: "text-teal-500/70" },
                  amber:   { bg: "bg-amber-500/10",   border: "border-amber-500/25 hover:border-amber-400/50",   tag: "bg-amber-500/15 text-amber-300",   icon: "text-amber-400",   label: "text-amber-500/70" },
                  blue:    { bg: "bg-blue-500/10",    border: "border-blue-500/25 hover:border-blue-400/50",    tag: "bg-blue-500/15 text-blue-300",    icon: "text-blue-400",    label: "text-blue-500/70" },
                  purple:  { bg: "bg-purple-500/10",  border: "border-purple-500/25 hover:border-purple-400/50",  tag: "bg-purple-500/15 text-purple-300",  icon: "text-purple-400",  label: "text-purple-500/70" },
                  rose:    { bg: "bg-rose-500/10",    border: "border-rose-500/25 hover:border-rose-400/50",    tag: "bg-rose-500/15 text-rose-300",    icon: "text-rose-400",    label: "text-rose-500/70" },
                };
                const c = colorMap[card.color];
                return (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08 }}
                    className={`rounded-2xl border ${c.border} bg-slate-900/60 backdrop-blur-sm p-7 flex flex-col gap-5 transition-all group`}
                  >
                    <div className="flex items-start justify-between">
                      <div className={`p-3 rounded-xl ${c.bg}`}>
                        <card.icon className={`w-6 h-6 ${c.icon}`} />
                      </div>
                      <span className={`text-xs font-mono font-bold uppercase tracking-widest ${c.label}`}>{card.label}</span>
                    </div>
                    <div>
                      <h4 className="text-lg font-bold text-white mb-2">{card.title}</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">{card.desc}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-auto">
                      {card.tags.map((tag, j) => (
                        <span key={j} className={`text-xs px-2.5 py-1 rounded-full font-medium ${c.tag}`}>{tag}</span>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Bottom quote/stat row */}
            <motion.div
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              className="grid sm:grid-cols-3 gap-px bg-slate-800/60 rounded-2xl overflow-hidden border border-slate-800"
            >
              {[
                { stat: "6", label: "Proof points", sub: "Covering every NZ govt tender sustainability criterion" },
                { stat: "1-click", label: "Tender Evidence Pack", sub: "Print-ready PDF, auto-generated from live data" },
                { stat: "100%", label: "Audit traceable", sub: "Every data point is timestamped, attributed, and immutable" },
              ].map((s, i) => (
                <div key={i} className="px-8 py-7 bg-slate-900/80">
                  <div className="text-3xl font-bold text-emerald-400 mb-1 font-mono">{s.stat}</div>
                  <div className="font-semibold text-white text-sm mb-1">{s.label}</div>
                  <div className="text-xs text-slate-500 leading-relaxed">{s.sub}</div>
                </div>
              ))}
            </motion.div>
          </div>
        </section>

        {/* ── SECURITY & MULTI-TENANCY ─────────────────────────────────────── */}
        <section className="py-24 bg-background">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4">Enterprise-grade security. Multi-tenant by design.</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                Each organisation is fully isolated. Every action is logged. Built for boards, auditors, and regulators.
              </p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                { icon: Fingerprint, title: "Passkey / WebAuthn", desc: "Passwordless login via Face ID, Touch ID, or Windows Hello. No passwords to phish." },
                { icon: Lock, title: "Role-Based Access", desc: "Super Admin, Admin, Manager, Viewer roles per organisation with granular permissions." },
                { icon: Database, title: "Full Audit Log", desc: "Every login, data change, and report download is recorded in an immutable audit trail." },
                { icon: ShieldCheck, title: "Per-Org Isolation", desc: "Multi-tenant architecture. Each organisation's data is fully isolated. Branded portals available." },
              ].map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.1 }}
                  className="p-7 rounded-2xl border border-border bg-white shadow-sm text-center"
                >
                  <div className="p-3 rounded-xl bg-slate-100 w-fit mx-auto mb-4">
                    <item.icon className="w-6 h-6 text-slate-700" />
                  </div>
                  <h4 className="font-bold text-foreground mb-2">{item.title}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PHASE NARRATIVE ──────────────────────────────────────────────── */}
        <section className="py-32 relative overflow-hidden bg-muted/50 border-y border-border">
          <div className="container mx-auto px-6 max-w-5xl">
            <motion.div initial="hidden" whileInView="show" viewport={{ once: true }} variants={staggerContainer} className="text-center mb-20">
              <motion.h2 variants={fadeIn} className="text-3xl md:text-4xl font-bold mb-6 text-foreground">
                "Traditional ESG platforms measure performance. <br />
                <span className="text-primary">EnviroIQ improves it.</span>"
              </motion.h2>
            </motion.div>

            <div className="space-y-6 relative before:absolute before:inset-y-0 before:left-[28px] md:before:left-1/2 before:w-px before:bg-border">
              {[
                { phase: "Phase 1", title: "Manual Reporting", desc: "Spreadsheets, consultants, lagging data — annual ESG reports that arrive too late to act on", current: false },
                { phase: "Phase 2", title: "Digital Reporting Platforms", desc: "Better structure, same lag — data is still collected after the fact and manually entered", current: false },
                { phase: "Phase 3", title: "Operational ESG (EnviroIQ)", desc: "Live data, real-time decisions, AI-generated narratives, and continuous optimisation across E, S, and G", current: true }
              ].map((phase, i) => (
                <motion.div
                  initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  key={i}
                  className={`relative flex items-center md:justify-between flex-col md:flex-row gap-8 ${phase.current ? "text-primary" : "text-muted-foreground"}`}
                >
                  <div className={`w-full md:w-5/12 ${i % 2 === 0 ? "md:text-right" : "md:order-3"}`}>
                    <div className={`p-6 rounded-2xl border ${phase.current ? "border-primary/40 bg-primary/5 shadow-sm" : "border-border bg-white shadow-sm"}`}>
                      <div className="font-mono text-sm mb-2 opacity-70">{phase.phase}</div>
                      <h4 className={`text-xl font-bold mb-2 ${phase.current ? "text-primary" : "text-foreground"}`}>{phase.title}</h4>
                      <p className="opacity-80">{phase.desc}</p>
                    </div>
                  </div>
                  <div className={`absolute left-0 md:static w-14 h-14 rounded-full border-4 flex items-center justify-center z-10 md:order-2 bg-background ${phase.current ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                    <span className="font-mono font-bold">{i + 1}</span>
                  </div>
                  <div className={`hidden md:block w-5/12 ${i % 2 === 0 ? "order-3" : "order-1"}`} />
                </motion.div>
              ))}
            </div>
            <div className="mt-20 text-center">
              <h3 className="text-2xl font-mono text-primary font-bold">EnviroIQ is phase three.</h3>
            </div>
          </div>
        </section>

        {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
        <section className="py-32 bg-primary text-primary-foreground relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
          <div className="container mx-auto px-6 relative z-10 text-center">
            <h2 className="text-5xl md:text-7xl font-bold mb-8 tracking-tight max-w-5xl mx-auto">
              If your ESG data is a month old, your decisions are already wrong.
            </h2>
            <div className="flex flex-wrap justify-center gap-4 text-xl font-medium opacity-90 mb-12">
              <span>Full E + S + G.</span>
              <span className="opacity-50">•</span>
              <span>Real-time Intelligence.</span>
              <span className="opacity-50">•</span>
              <span>Board-Ready in Seconds.</span>
              <span className="opacity-50">•</span>
              <span>Built for New Zealand.</span>
            </div>
            <Button size="lg" className="bg-white text-primary hover:bg-white/90 h-16 px-10 text-xl shadow-2xl font-semibold" asChild>
              <a href="mailto:hello@enviroiq.net">
                Request a Demo Now
              </a>
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
