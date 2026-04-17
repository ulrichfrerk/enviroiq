export default function Positioning() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_left,rgba(34,197,94,0.12),transparent_60%)]" />

      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="font-mono text-[1vw] text-primary uppercase tracking-[0.3em]">02 — Positioning</div>
        <div className="w-[6vw] h-px bg-line" />
      </div>

      <div className="px-[6vw] pt-[16vh] h-full flex flex-col">
        <div className="text-[1.3vw] text-muted font-medium">EnviroIQ is not another ESG dashboard.</div>
        <h2 className="mt-[2vh] font-display font-bold text-[5.2vw] leading-[0.98] tracking-tighter max-w-[80vw]">
          Real-time operational intelligence with
          <span className="text-primary"> audit-grade ESG outputs.</span>
        </h2>

        <div className="mt-[8vh] grid grid-cols-3 gap-[2vw]">
          <div className="border-l-[3px] border-primary pl-[1.5vw]">
            <div className="font-display font-bold text-[2.2vw] leading-tight">Operational</div>
            <div className="mt-[1vh] text-[1.15vw] text-muted leading-relaxed">
              Live fuel, energy, waste, fleet and supplier signals — not quarterly retro-fits.
            </div>
          </div>
          <div className="border-l-[3px] border-primary pl-[1.5vw]">
            <div className="font-display font-bold text-[2.2vw] leading-tight">Audit-grade</div>
            <div className="mt-[1vh] text-[1.15vw] text-muted leading-relaxed">
              Immutable data, versioned factors, full lineage from raw source to board number.
            </div>
          </div>
          <div className="border-l-[3px] border-primary pl-[1.5vw]">
            <div className="font-display font-bold text-[2.2vw] leading-tight">Enterprise-ready</div>
            <div className="mt-[1vh] text-[1.15vw] text-muted leading-relaxed">
              Passkey auth, MFA, RBAC, NZ sovereign hosting, SOC 2 roadmap on the trust page.
            </div>
          </div>
        </div>

        <div className="mt-auto mb-[8vh] rounded-xl border border-primary/30 bg-primary/5 p-[2vw] max-w-[70vw]">
          <div className="font-mono text-[0.95vw] text-primary uppercase tracking-[0.25em]">The narrative</div>
          <div className="mt-[1vh] font-display text-[2vw] leading-tight font-semibold">
            "We don't just give you ESG data. We give you ESG data your board, auditor and regulator will trust."
          </div>
        </div>
      </div>
    </div>
  );
}
