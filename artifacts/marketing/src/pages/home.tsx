import { motion } from "framer-motion";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Button } from "@/components/ui/button";
import { ArrowRight, Activity, Eye, FileCheck, LayoutDashboard, Zap, Droplet, Truck, Building2, Server, Leaf } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const staggerContainer = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1
    }
  }
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
        {/* HERO SECTION */}
        <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
          <div className="absolute inset-0 z-0">
            <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-background to-background" />
            <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-primary/8 rounded-full blur-[120px] opacity-60 pointer-events-none" />
          </div>

          <div className="container mx-auto px-6 relative z-10">
            <motion.div
              variants={staggerContainer}
              initial="hidden"
              animate="show"
              className="max-w-4xl"
            >
              <motion.div variants={fadeIn} className="mb-6 flex items-center gap-3">
                <Badge variant="outline" className="border-primary/30 text-primary bg-primary/8 px-3 py-1">
                  <Activity className="w-3 h-3 mr-2" />
                  The Operational ESG Layer
                </Badge>
                <span className="text-sm font-mono text-muted-foreground">STATUS: LIVE</span>
              </motion.div>

              <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl font-bold tracking-tighter mb-8 leading-[1.1]">
                EnviroIQ: <br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-500">
                  Real Time ESG Intelligence
                </span>
              </motion.h1>

              <motion.p variants={fadeIn} className="text-xl md:text-2xl text-muted-foreground mb-6 max-w-3xl leading-relaxed">
                From retrospective reporting to live operational control.
              </motion.p>

              <motion.p variants={fadeIn} className="text-lg text-muted-foreground/80 mb-10 max-w-2xl leading-relaxed">
                Turn your energy, fleet, water, and infrastructure data into real time sustainability performance — not month-end reports.
              </motion.p>

              <motion.div variants={fadeIn} className="flex flex-col sm:flex-row gap-4">
                <Button size="lg" className="bg-primary text-primary-foreground hover:bg-primary/90 h-14 px-8 text-lg group" asChild>
                  <a href="mailto:hello@enviroiq.net">
                    Request a Demo
                    <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </a>
                </Button>
                <Button size="lg" variant="outline" className="h-14 px-8 text-lg border-border hover:bg-muted" asChild>
                  <a href="#how-it-works">See How it Works</a>
                </Button>
              </motion.div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.4 }}
              className="mt-20 relative rounded-2xl border border-border bg-card overflow-hidden shadow-xl"
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

        {/* THE PROBLEM SECTION */}
        <section id="problem" className="py-24 bg-muted/50 border-y border-border relative">
          <div className="container mx-auto px-6">
            <div className="grid md:grid-cols-2 gap-16 items-center">
              <motion.div
                initial="hidden"
                whileInView="show"
                viewport={{ once: true, margin: "-100px" }}
                variants={staggerContainer}
              >
                <motion.h2 variants={fadeIn} className="text-4xl font-bold mb-6">
                  ESG today is <span className="text-destructive">broken.</span>
                </motion.h2>

                <ul className="space-y-6 mb-10">
                  {[
                    "Reports are 30 to 90 days behind reality",
                    "Data is fragmented across systems",
                    "Decisions are made on averages, not truth",
                    "Compliance is manual, expensive, and reactive"
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
                className="relative h-full min-h-[400px] rounded-2xl border border-border bg-white shadow-md flex flex-col justify-center p-10"
              >
                <div className="space-y-8">
                  <div className="flex items-center gap-4 opacity-40">
                    <div className="w-12 h-12 rounded-full border border-dashed border-gray-300 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">Q1</span>
                    </div>
                    <div className="h-px flex-1 bg-gray-200" />
                    <div className="text-sm font-mono text-center text-muted-foreground">Data Collection</div>
                  </div>
                  <div className="flex items-center gap-4 opacity-60">
                    <div className="w-12 h-12 rounded-full border border-dashed border-gray-300 flex items-center justify-center">
                      <span className="text-xs text-muted-foreground">Q2</span>
                    </div>
                    <div className="h-px flex-1 bg-gray-200" />
                    <div className="text-sm font-mono text-center text-muted-foreground">Spreadsheet Aggregation</div>
                  </div>
                  <div className="flex items-center gap-4 text-destructive">
                    <div className="w-12 h-12 rounded-full border border-destructive bg-destructive/10 flex items-center justify-center">
                      <span className="text-xs font-bold">Q3</span>
                    </div>
                    <div className="h-px flex-1 bg-destructive" />
                    <div className="text-sm font-mono font-bold text-center">Decisions Made (Too Late)</div>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        {/* DIFFERENTIATION SECTION */}
        <section id="solution" className="py-32 relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.06)_0%,transparent_70%)]" />

          <div className="container mx-auto px-6 relative z-10 text-center">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="max-w-4xl mx-auto"
            >
              <motion.h2 variants={fadeIn} className="text-sm font-mono text-primary mb-4 tracking-wider">PHASE THREE OF ESG</motion.h2>
              <motion.h3 variants={fadeIn} className="text-4xl md:text-5xl font-bold mb-8 text-foreground">
                EnviroIQ introduces the <br className="hidden md:block" />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-foreground to-muted-foreground">Operational ESG Layer</span>
              </motion.h3>

              <motion.p variants={fadeIn} className="text-2xl text-muted-foreground mb-16">
                Instead of asking <span className="italic text-foreground/50">"What happened last quarter?"</span> — you now ask:
              </motion.p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-left mb-16">
                {[
                  { q: "What's happening right now?", icon: Activity },
                  { q: "Where are we wasting energy?", icon: Zap },
                  { q: "Which assets are underperforming?", icon: Building2 },
                  { q: "What do we fix today?", icon: Eye }
                ].map((item, i) => (
                  <motion.div variants={fadeIn} key={i} className="p-6 rounded-2xl bg-white border border-border hover:border-primary/40 transition-colors flex items-center gap-4 shadow-sm">
                    <div className="p-3 rounded-lg bg-primary/10 text-primary shrink-0">
                      <item.icon className="w-6 h-6" />
                    </div>
                    <span className="text-xl font-medium text-foreground">{item.q}</span>
                  </motion.div>
                ))}
              </div>

              <motion.div
                initial={{ opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 1 }}
                className="relative rounded-2xl border border-border overflow-hidden shadow-xl"
              >
                <img
                  src={`${import.meta.env.BASE_URL}images/dashboard-mockup.png`}
                  alt="EnviroIQ Dashboard UI Mockup"
                  className="w-full h-auto object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
              </motion.div>
            </motion.div>
          </div>
        </section>

        {/* HOW IT WORKS / PIPELINE */}
        <section id="how-it-works" className="py-24 bg-muted/50 border-y border-border">
          <div className="container mx-auto px-6">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold mb-4 text-foreground">Connects directly into live systems</h2>
              <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
                No more chasing spreadsheets. We pull raw telemetry data and convert it instantly.
              </p>
            </div>

            <div className="flex flex-col lg:flex-row items-center justify-between gap-12 relative">
              {/* Left side inputs */}
              <div className="flex-1 space-y-3 w-full">
                {[
                  "Energy meters & EM6 data",
                  "Vehicle GPS & fleet systems",
                  "Fuel usage & telematics",
                  "Solar & generation systems",
                  "Building & HVAC systems",
                  "Water & waste tracking",
                  "Procurement & supplier data"
                ].map((item, i) => (
                  <div key={i} className="px-5 py-3.5 rounded-xl bg-white border border-border text-sm font-mono text-muted-foreground flex items-center shadow-sm">
                    <div className="w-2 h-2 rounded-full bg-primary/60 mr-4 shrink-0" />
                    {item}
                  </div>
                ))}
              </div>

              {/* Center Node */}
              <div className="shrink-0 relative">
                <div className="w-32 h-32 rounded-full bg-primary/10 border-4 border-primary flex items-center justify-center shadow-[0_0_40px_rgba(34,197,94,0.20)] z-10 relative">
                  <Leaf className="w-12 h-12 text-primary" />
                </div>
                <div className="hidden lg:block absolute top-1/2 -left-12 w-12 h-px bg-primary/40" />
                <div className="hidden lg:block absolute top-1/2 -right-12 w-12 h-px bg-primary/40" />
              </div>

              {/* Right side outputs */}
              <div className="flex-1 space-y-3 w-full">
                {[
                  "Live emissions (Scope 1, 2, relevant 3)",
                  "Real time sustainability KPIs",
                  "Operational alerts and insights",
                  "Audit-ready ESG reporting",
                  "Public-facing dashboards"
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

        {/* VALUE PILLARS */}
        <section id="features" className="py-32 bg-background">
          <div className="container mx-auto px-6">
            <div className="text-center mb-20">
              <h2 className="text-4xl md:text-5xl font-bold mb-6 text-foreground">Value Pillars</h2>
              <p className="text-xl text-muted-foreground">From compliance to control.</p>
            </div>

            <div className="grid md:grid-cols-2 gap-8">
              {[
                {
                  title: "See Everything",
                  desc: "Single view across energy, fleet, water, waste, and infrastructure. No more fragmented data.",
                  icon: Eye,
                  metric: "100% Visibility"
                },
                {
                  title: "Act in Real Time",
                  desc: "Identify inefficiencies instantly. Reduce cost, emissions, and waste as it happens.",
                  icon: Activity,
                  metric: "< 1s Latency"
                },
                {
                  title: "Prove It",
                  desc: "Automatically generate compliant, audit-ready ESG reports. No more chasing spreadsheets.",
                  icon: FileCheck,
                  metric: "Audit-Ready"
                },
                {
                  title: "Show It",
                  desc: "Embed real time sustainability dashboards directly on your website. Turn ESG into a competitive advantage.",
                  icon: LayoutDashboard,
                  metric: "Public API"
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

        {/* USE CASES */}
        <section id="use-cases" className="py-32 bg-muted/50 border-y border-border">
          <div className="container mx-auto px-6">
            <h2 className="text-4xl md:text-5xl font-bold mb-16 text-center text-foreground">Built for Heavy Operations</h2>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {[
                {
                  title: "Infrastructure & Data Centres",
                  desc: "Optimise cooling and power usage, track PUE and active efficiency, reduce operational cost.",
                  icon: Server
                },
                {
                  title: "Fleet & Transport",
                  desc: "Reduce fuel consumption, eliminate idle time, improve route efficiency.",
                  icon: Truck
                },
                {
                  title: "Commercial Buildings",
                  desc: "Monitor HVAC performance, reduce energy waste, track water usage.",
                  icon: Building2
                },
                {
                  title: "Construction & Civil",
                  desc: "Live site emissions tracking, equipment utilisation, compliance reporting.",
                  icon: Zap
                }
              ].map((uc, i) => (
                <div key={i} className="p-8 rounded-2xl border border-border bg-white shadow-sm hover:shadow-md hover:border-primary/30 transition-all flex flex-col">
                  <div className="p-3 rounded-xl bg-primary/10 w-fit mb-6">
                    <uc.icon className="w-7 h-7 text-primary" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 text-foreground">{uc.title}</h3>
                  <p className="text-muted-foreground flex-1">{uc.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* NARRATIVE SECTION */}
        <section className="py-32 relative overflow-hidden bg-background">
          <div className="container mx-auto px-6 max-w-5xl">
            <motion.div
              initial="hidden"
              whileInView="show"
              viewport={{ once: true }}
              variants={staggerContainer}
              className="text-center mb-20"
            >
              <motion.h2 variants={fadeIn} className="text-3xl md:text-4xl font-bold mb-6 text-foreground">
                "Traditional ESG platforms measure performance. <br/>
                <span className="text-primary">EnviroIQ improves it.</span>"
              </motion.h2>
            </motion.div>

            <div className="space-y-6 relative before:absolute before:inset-y-0 before:left-[28px] md:before:left-1/2 before:w-px before:bg-border">
              {[
                { phase: "Phase 1", title: "Manual Reporting", desc: "Spreadsheets, consultants, lagging data", current: false },
                { phase: "Phase 2", title: "Digital Reporting Platforms", desc: "Better structure, same lag", current: false },
                { phase: "Phase 3", title: "Operational ESG (EnviroIQ)", desc: "Live data, real time decisions, continuous optimisation", current: true }
              ].map((phase, i) => (
                <motion.div
                  initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  key={i}
                  className={`relative flex items-center md:justify-between flex-col md:flex-row gap-8 ${phase.current ? 'text-primary' : 'text-muted-foreground'}`}
                >
                  <div className={`w-full md:w-5/12 ${i % 2 === 0 ? 'md:text-right' : 'md:order-3'}`}>
                    <div className={`p-6 rounded-2xl border ${phase.current ? 'border-primary/40 bg-primary/5 shadow-sm' : 'border-border bg-white shadow-sm'}`}>
                      <div className="font-mono text-sm mb-2 opacity-70">{phase.phase}</div>
                      <h4 className={`text-xl font-bold mb-2 ${phase.current ? 'text-primary' : 'text-foreground'}`}>{phase.title}</h4>
                      <p className="opacity-80">{phase.desc}</p>
                    </div>
                  </div>

                  <div className={`absolute left-0 md:static w-14 h-14 rounded-full border-4 flex items-center justify-center z-10 md:order-2 bg-background ${phase.current ? 'border-primary text-primary' : 'border-border text-muted-foreground'}`}>
                    <span className="font-mono font-bold">{i + 1}</span>
                  </div>

                  <div className={`hidden md:block w-5/12 ${i % 2 === 0 ? 'order-3' : 'order-1'}`} />
                </motion.div>
              ))}
            </div>

            <div className="mt-20 text-center">
              <h3 className="text-2xl font-mono text-primary font-bold">EnviroIQ is phase three.</h3>
            </div>
          </div>
        </section>

        {/* CLOSING CTA */}
        <section className="py-32 bg-primary text-primary-foreground relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
          <div className="container mx-auto px-6 relative z-10 text-center">
            <h2 className="text-5xl md:text-7xl font-bold mb-8 tracking-tight max-w-5xl mx-auto">
              If your ESG data is a month old, your decisions are already wrong.
            </h2>
            <div className="flex flex-wrap justify-center gap-4 text-xl font-medium opacity-90 mb-12">
              <span>Real time ESG.</span>
              <span className="opacity-50">•</span>
              <span>Real world impact.</span>
              <span className="opacity-50">•</span>
              <span>Measure less. Control more.</span>
              <span className="opacity-50">•</span>
              <span>Know now. Act now.</span>
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
