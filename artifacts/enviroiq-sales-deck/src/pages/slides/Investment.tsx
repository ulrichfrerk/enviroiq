export default function Investment() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute top-0 right-0 w-[55vw] h-[55vh] bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.18),transparent_60%)]" />

      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="font-mono text-[1vw] text-primary uppercase tracking-[0.3em]">06 — Investment &amp; next steps</div>
        <div className="w-[6vw] h-px bg-line" />
      </div>

      <div className="px-[6vw] pt-[14vh] pb-[6vh] h-full flex flex-col">
        <h2 className="font-display font-bold text-[4.4vw] leading-[1] tracking-tight max-w-[70vw]">
          A board-grade ESG platform, priced for the value it unlocks.
        </h2>

        <div className="mt-[6vh] grid grid-cols-3 gap-[1.6vw]">
          <div className="rounded-xl border border-line bg-surface p-[2vw]">
            <div className="font-mono text-[0.95vw] text-muted uppercase tracking-[0.25em]">Operate</div>
            <div className="mt-[1.5vh] flex items-baseline gap-[0.5vw]">
              <div className="font-display font-bold text-[3.2vw] leading-none">$60k</div>
              <div className="text-[1vw] text-muted">/ year</div>
            </div>
            <div className="mt-[2vh] text-[1.05vw] text-muted leading-relaxed">
              Single org. E + S + G modules. Lineage + audit log. Branded PDFs. Email support.
            </div>
          </div>

          <div className="rounded-xl border-2 border-primary bg-gradient-to-b from-primary/10 to-transparent p-[2vw] relative">
            <div className="absolute -top-[1.5vh] left-[2vw] px-[1vw] py-[0.5vh] rounded-full bg-primary text-bg text-[0.85vw] font-mono uppercase tracking-[0.2em] font-semibold">Most chosen</div>
            <div className="font-mono text-[0.95vw] text-primary uppercase tracking-[0.25em]">Assure</div>
            <div className="mt-[1.5vh] flex items-baseline gap-[0.5vw]">
              <div className="font-display font-bold text-[3.2vw] leading-none">$150k</div>
              <div className="text-[1vw] text-muted">/ year</div>
            </div>
            <div className="mt-[2vh] text-[1.05vw] text-muted leading-relaxed">
              Everything in Operate, plus Supplier Assurance, AI Advisor, maturity benchmarking, auditor role.
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-[2vw]">
            <div className="font-mono text-[0.95vw] text-muted uppercase tracking-[0.25em]">Enterprise</div>
            <div className="mt-[1.5vh] flex items-baseline gap-[0.5vw]">
              <div className="font-display font-bold text-[3.2vw] leading-none">$300k+</div>
              <div className="text-[1vw] text-muted">/ year</div>
            </div>
            <div className="mt-[2vh] text-[1.05vw] text-muted leading-relaxed">
              Multi-tenant. Custom data sources. Dedicated CSM. SOC 2 evidence pack. SLA &amp; DPA.
            </div>
          </div>
        </div>

        <div className="mt-auto rounded-2xl border border-line bg-surface p-[2vw] flex items-center justify-between">
          <div>
            <div className="font-mono text-[0.95vw] text-primary uppercase tracking-[0.25em]">Next step</div>
            <div className="mt-[1vh] font-display font-bold text-[2.4vw] leading-tight">90-minute working session</div>
            <div className="mt-[1vh] text-[1.1vw] text-muted">Live walkthrough on your data. Trust page review with your CFO + GC. Pilot scope agreed.</div>
          </div>
          <div className="text-right">
            <div className="font-mono text-[0.95vw] text-muted uppercase tracking-[0.25em]">Contact</div>
            <div className="mt-[1vh] text-[1.6vw] font-display font-semibold">contact@frerkencompanies.com</div>
            <div className="mt-[0.5vh] text-[1.1vw] text-muted font-mono">enviroiq.net/trust</div>
          </div>
        </div>
      </div>
    </div>
  );
}
