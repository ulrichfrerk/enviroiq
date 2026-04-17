export default function Platform() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="font-mono text-[1vw] text-primary uppercase tracking-[0.3em]">04 — The platform</div>
        <div className="w-[6vw] h-px bg-line" />
      </div>

      <div className="px-[6vw] pt-[14vh] pb-[6vh] h-full flex flex-col">
        <h2 className="font-display font-bold text-[4.4vw] leading-[1] tracking-tight max-w-[70vw]">
          Full E + S + G coverage in one platform.
        </h2>
        <p className="mt-[2.5vh] text-[1.3vw] text-muted max-w-[55vw]">
          Modular by design — start with what's urgent, expand to the rest when the board asks.
        </p>

        <div className="mt-[6vh] grid grid-cols-4 gap-[1.5vw]">
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-primary uppercase tracking-[0.25em]">Environmental</div>
            <div className="mt-[1vh] font-display font-bold text-[1.8vw] leading-tight">Emissions &amp; energy</div>
            <div className="mt-[1.5vh] text-[1vw] text-muted leading-relaxed">
              Fleet, fuel, electricity, waste. Live em6 NZ grid. NZ MfE 2024 factors.
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-primary uppercase tracking-[0.25em]">Social</div>
            <div className="mt-[1vh] font-display font-bold text-[1.8vw] leading-tight">People &amp; safety</div>
            <div className="mt-[1.5vh] text-[1vw] text-muted leading-relaxed">
              Headcount, diversity, training, incidents, community spend.
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-primary uppercase tracking-[0.25em]">Governance</div>
            <div className="mt-[1vh] font-display font-bold text-[1.8vw] leading-tight">Policy &amp; risk</div>
            <div className="mt-[1.5vh] text-[1vw] text-muted leading-relaxed">
              Board composition, policy attestations, risk register, conflicts.
            </div>
          </div>
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-primary uppercase tracking-[0.25em]">Supplier assurance</div>
            <div className="mt-[1vh] font-display font-bold text-[1.8vw] leading-tight">ESG audits at scale</div>
            <div className="mt-[1.5vh] text-[1vw] text-muted leading-relaxed">
              Send signed-link audits to every vendor. Auto-score. Recurrence. Board-pack PDF.
            </div>
          </div>
        </div>

        <div className="mt-[5vh] grid grid-cols-3 gap-[1.5vw]">
          <div className="rounded-lg border border-line bg-surface/50 px-[1.5vw] py-[1.8vh]">
            <div className="font-display font-semibold text-[1.4vw]">AI ESG Advisor</div>
            <div className="mt-[0.6vh] text-[1vw] text-muted">Plain-English recommendations grounded in your live data.</div>
          </div>
          <div className="rounded-lg border border-line bg-surface/50 px-[1.5vw] py-[1.8vh]">
            <div className="font-display font-semibold text-[1.4vw]">Server-side board PDFs</div>
            <div className="mt-[0.6vh] text-[1vw] text-muted">One-click, branded, identical for every reader.</div>
          </div>
          <div className="rounded-lg border border-line bg-surface/50 px-[1.5vw] py-[1.8vh]">
            <div className="font-display font-semibold text-[1.4vw]">Maturity scoring</div>
            <div className="mt-[0.6vh] text-[1vw] text-muted">Benchmark against NZ peers. Track quarter-on-quarter movement.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
