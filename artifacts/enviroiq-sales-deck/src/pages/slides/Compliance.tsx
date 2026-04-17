export default function Compliance() {
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-bg">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(34,197,94,0.14),transparent_55%)]" />

      <div className="absolute top-[6vh] left-[6vw] flex items-center gap-[1vw]">
        <div className="font-mono text-[1vw] text-primary uppercase tracking-[0.3em]">05 — Compliance &amp; security</div>
        <div className="w-[6vw] h-px bg-line" />
      </div>

      <div className="px-[6vw] pt-[14vh] pb-[6vh] h-full grid grid-cols-12 gap-[2vw]">
        <div className="col-span-5 flex flex-col justify-center">
          <h2 className="font-display font-bold text-[4vw] leading-[1] tracking-tight">
            Built to clear procurement on day one.
          </h2>
          <p className="mt-[3vh] text-[1.25vw] text-muted leading-relaxed max-w-[34vw]">
            Every control a $120M buyer's vendor security review will ask for — already in the platform or on a dated roadmap.
          </p>
          <div className="mt-[4vh] inline-flex items-center gap-[1vw] rounded-full border border-primary/30 bg-primary/5 px-[1.5vw] py-[1.2vh] w-fit">
            <div className="w-[0.8vw] h-[0.8vw] rounded-full bg-primary" />
            <div className="font-mono text-[1vw] uppercase tracking-[0.2em] text-primary">NZ sovereign · Auckland hosted</div>
          </div>
        </div>

        <div className="col-span-7 grid grid-cols-2 gap-[1.4vw]">
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.25em]">Identity</div>
            <div className="mt-[1vh] font-display font-semibold text-[1.6vw]">Passkey + MFA</div>
            <div className="mt-[1vh] text-[1vw] text-muted">WebAuthn-first, TOTP fallback, org-wide enforcement.</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.25em]">Access</div>
            <div className="mt-[1vh] font-display font-semibold text-[1.6vw]">RBAC + auditor role</div>
            <div className="mt-[1vh] text-[1vw] text-muted">Admin, user, read-only auditor — scoped per organisation.</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.25em]">Data integrity</div>
            <div className="mt-[1vh] font-display font-semibold text-[1.6vw]">Immutable + versioned</div>
            <div className="mt-[1vh] text-[1vw] text-muted">Append-only ingestion, locked reporting periods.</div>
          </div>
          <div className="rounded-xl border border-line bg-surface p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-muted uppercase tracking-[0.25em]">Encryption</div>
            <div className="mt-[1vh] font-display font-semibold text-[1.6vw]">In transit + at rest</div>
            <div className="mt-[1vh] text-[1vw] text-muted">TLS 1.3, AES-256 at rest, secrets in managed vault.</div>
          </div>
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-primary uppercase tracking-[0.25em]">SOC 2 Type I</div>
            <div className="mt-[1vh] font-display font-semibold text-[1.6vw]">Target H1 2026</div>
            <div className="mt-[1vh] text-[1vw] text-muted">Evidence pipeline already wired into the audit log.</div>
          </div>
          <div className="rounded-xl border border-primary/40 bg-primary/5 p-[1.6vw]">
            <div className="font-mono text-[0.85vw] text-primary uppercase tracking-[0.25em]">ISO 27001</div>
            <div className="mt-[1vh] font-display font-semibold text-[1.6vw]">Aligned · cert in plan</div>
            <div className="mt-[1vh] text-[1vw] text-muted">Controls mapped, gap-assessment scheduled.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
