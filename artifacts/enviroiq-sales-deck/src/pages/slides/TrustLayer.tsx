export default function TrustLayer() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="font-mono text-[1vw] text-primary uppercase tracking-[0.3em]">03 — The trust layer</div>
        <div className="w-[6vw] h-px bg-line" />
      </div>

      <div className="grid grid-cols-2 gap-[3vw] h-full pt-[14vh] pb-[6vh] px-[6vw]">
        <div className="flex flex-col justify-center">
          <h2 className="font-display font-bold text-[4vw] leading-[1] tracking-tight">
            Click any number.<br className="hidden" />
            <span className="text-primary"> See where it came from.</span>
          </h2>
          <p className="mt-[3vh] text-[1.3vw] text-muted leading-relaxed max-w-[34vw]">
            Every metric in EnviroIQ has a lineage badge. One click reveals the raw source rows, the emission factor version applied, the import batch, who triggered it, and the exact timestamp.
          </p>

          <div className="mt-[4vh] grid grid-cols-2 gap-[1.5vw]">
            <div className="rounded-lg border border-line bg-surface px-[1.5vw] py-[1.5vh]">
              <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.2em]">Immutable</div>
              <div className="mt-[0.6vh] text-[1.15vw] font-medium">Append-only ingestion</div>
            </div>
            <div className="rounded-lg border border-line bg-surface px-[1.5vw] py-[1.5vh]">
              <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.2em]">Versioned</div>
              <div className="mt-[0.6vh] text-[1.15vw] font-medium">Every factor + calc</div>
            </div>
            <div className="rounded-lg border border-line bg-surface px-[1.5vw] py-[1.5vh]">
              <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.2em]">Logged</div>
              <div className="mt-[0.6vh] text-[1.15vw] font-medium">User &amp; system actions</div>
            </div>
            <div className="rounded-lg border border-line bg-surface px-[1.5vw] py-[1.5vh]">
              <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.2em]">Replayable</div>
              <div className="mt-[0.6vh] text-[1.15vw] font-medium">Restate any period</div>
            </div>
          </div>
        </div>

        <div className="relative flex items-center justify-center">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(34,197,94,0.18),transparent_65%)]" />
          <div className="relative w-full rounded-2xl border border-line bg-surface shadow-2xl shadow-black/40 p-[2vw]">
            <div className="flex items-center justify-between">
              <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.2em]">Total scope 1 + 2</div>
              <div className="px-[0.8vw] py-[0.4vh] rounded-md bg-primary/15 text-primary text-[0.85vw] font-mono uppercase tracking-[0.15em]">lineage</div>
            </div>
            <div className="mt-[1vh] font-display font-bold text-[5.5vw] leading-none tracking-tight">847.2<span className="text-[2.2vw] text-muted ml-[0.5vw]">tCO₂e</span></div>

            <div className="mt-[3vh] border-t border-line pt-[2vh] space-y-[1.4vh]">
              <div className="flex items-start gap-[1vw]">
                <div className="font-mono text-[0.85vw] text-muted w-[7vw] uppercase tracking-[0.15em]">Source</div>
                <div className="flex-1 text-[1vw]">FuelSaver API · 2,431 rows · batch <span className="font-mono text-primary">b_8a2f</span></div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="font-mono text-[0.85vw] text-muted w-[7vw] uppercase tracking-[0.15em]">Factor</div>
                <div className="flex-1 text-[1vw]">NZ MfE diesel <span className="font-mono">v2024.1</span> · 2.681 kgCO₂e/L</div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="font-mono text-[0.85vw] text-muted w-[7vw] uppercase tracking-[0.15em]">Grid</div>
                <div className="flex-1 text-[1vw]">em6 NZ live · 40.31 gCO₂/kWh · 94.3% renewable</div>
              </div>
              <div className="flex items-start gap-[1vw]">
                <div className="font-mono text-[0.85vw] text-muted w-[7vw] uppercase tracking-[0.15em]">Locked</div>
                <div className="flex-1 text-[1vw]">2026-04-17 06:24 NZST · ulrich@edgeops.nz</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
