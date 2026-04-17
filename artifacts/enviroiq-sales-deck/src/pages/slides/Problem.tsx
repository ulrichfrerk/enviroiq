export default function Problem() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute top-0 left-0 right-0 h-[0.4vh] bg-gradient-to-r from-transparent via-primary/40 to-transparent" />

      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="font-mono text-[1vw] text-primary uppercase tracking-[0.3em]">01 — The problem</div>
        <div className="w-[6vw] h-px bg-line" />
      </div>

      <div className="px-[6vw] pt-[18vh] pb-[8vh] h-full flex flex-col">
        <h2 className="font-display font-bold text-[4.6vw] leading-[1] tracking-tight max-w-[68vw]">
          Most ESG dashboards are <span className="text-primary">"trust me"</span> data.
        </h2>
        <p className="mt-[3vh] text-[1.5vw] text-muted max-w-[60vw] leading-relaxed">
          Beautiful charts. Numbers nobody can defend. The moment a CFO, auditor or regulator pokes the figure, the credibility collapses.
        </p>

        <div className="mt-[7vh] grid grid-cols-3 gap-[2vw]">
          <div className="rounded-xl border border-line bg-surface p-[2.4vw]">
            <div className="font-mono text-[0.95vw] text-primary uppercase tracking-[0.25em]">Boards</div>
            <div className="mt-[1.5vh] font-display font-bold text-[2.6vw] leading-[1.05] tracking-tight">
              Lose confidence in the number.
            </div>
            <div className="mt-[2vh] text-[1.15vw] text-muted leading-relaxed">
              No source. No version. No audit trail. The CFO can't sign it off.
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-[2.4vw]">
            <div className="font-mono text-[0.95vw] text-primary uppercase tracking-[0.25em]">Auditors</div>
            <div className="mt-[1.5vh] font-display font-bold text-[2.6vw] leading-[1.05] tracking-tight">
              Reject the evidence.
            </div>
            <div className="mt-[2vh] text-[1.15vw] text-muted leading-relaxed">
              Manual spreadsheets. Editable cells. Zero lineage. Limited assurance at best.
            </div>
          </div>

          <div className="rounded-xl border border-line bg-surface p-[2.4vw]">
            <div className="font-mono text-[0.95vw] text-primary uppercase tracking-[0.25em]">Procurement</div>
            <div className="mt-[1.5vh] font-display font-bold text-[2.6vw] leading-[1.05] tracking-tight">
              Stalls the deal.
            </div>
            <div className="mt-[2vh] text-[1.15vw] text-muted leading-relaxed">
              No SOC 2. No data residency. No RBAC. Vendor security review fails on day one.
            </div>
          </div>
        </div>

        <div className="mt-auto flex items-center gap-[1.5vw] text-[1.1vw] text-muted">
          <div className="w-[3vw] h-px bg-primary" />
          <span>The result: ESG becomes a marketing exercise, not a board-grade input.</span>
        </div>
      </div>
    </div>
  );
}
