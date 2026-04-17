export default function Title() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(34,197,94,0.18),transparent_55%)]" />
      <div className="absolute top-0 left-0 w-[40vw] h-[40vw] rounded-full bg-primary/10 blur-3xl -translate-x-1/3 -translate-y-1/3" />
      <div className="absolute bottom-0 right-0 w-[35vw] h-[35vw] rounded-full bg-accent/10 blur-3xl translate-x-1/3 translate-y-1/3" />

      <div className="absolute top-[6vh] left-[6vw] right-[6vw] flex items-center justify-between">
        <div className="flex items-center gap-[1vw]">
          <div className="w-[2.4vw] h-[2.4vw] rounded-md bg-primary flex items-center justify-center">
            <div className="w-[1.2vw] h-[1.2vw] rounded-sm bg-bg" />
          </div>
          <div className="text-[1.6vw] font-display font-bold tracking-tight">
            Enviro<span className="text-primary">IQ</span>
          </div>
        </div>
        <div className="font-mono text-[1vw] text-muted uppercase tracking-[0.25em]">Enterprise Briefing · 2026</div>
      </div>

      <div className="absolute inset-0 flex flex-col justify-center px-[6vw]">
        <div className="font-mono text-[1.1vw] text-primary uppercase tracking-[0.3em] mb-[2vh]">
          Real-time ESG · Audit-grade outputs
        </div>
        <h1 className="font-display font-bold text-[6.4vw] leading-[0.95] tracking-tighter max-w-[80vw]">
          ESG data your board, auditor and regulator will actually
          <span className="text-primary"> trust.</span>
        </h1>
        <p className="mt-[4vh] text-[1.7vw] text-muted max-w-[55vw] leading-relaxed font-body">
          Operational intelligence for the boardroom — every metric traceable from source to output, every action logged, every calculation versioned.
        </p>
      </div>

      <div className="absolute bottom-[6vh] left-[6vw] right-[6vw] flex items-end justify-between">
        <div className="flex items-center gap-[3vw]">
          <div>
            <div className="font-mono text-[0.9vw] text-muted uppercase tracking-[0.25em]">Prepared for</div>
            <div className="text-[1.4vw] font-medium mt-[0.5vh]">Enterprise procurement, ESG &amp; risk leaders</div>
          </div>
          <div className="w-px h-[5vh] bg-line" />
          <div>
            <div className="font-mono text-[0.9vw] text-muted uppercase tracking-[0.25em]">Hosted in</div>
            <div className="text-[1.4vw] font-medium mt-[0.5vh]">Auckland · NZ sovereign data</div>
          </div>
        </div>
        <div className="font-mono text-[1vw] text-muted">enviroiq.net</div>
      </div>
    </div>
  );
}
