import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1300),  // panels appear
      setTimeout(() => setPhase(3), 3600),  // center AI Advisor
      setTimeout(() => setPhase(4), 13500),
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.4, filter: 'blur(20px)' }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Background data grid video */}
      <div className="absolute inset-0 z-0 opacity-30 mix-blend-screen">
        <video 
          src={`${import.meta.env.BASE_URL}videos/data_grid.mp4`}
          autoPlay muted loop playsInline
          className="w-full h-full object-cover"
        />
      </div>

      {/* Top-left: SBTi Target progress card */}
      <motion.div
        className="absolute top-[6vh] left-[4vw] z-10 w-[24vw] bg-[#0a1410]/90 backdrop-blur-md border border-[#10b981]/25 rounded-xl p-4 shadow-2xl shadow-emerald-900/40"
        initial={{ opacity: 0, x: -50, y: -20 }}
        animate={phase >= 2 ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x: -50, y: -20 }}
        transition={{ duration: 0.7, delay: 0.05, type: 'spring', stiffness: 100 }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="text-[0.7vw] uppercase tracking-widest text-white/40">SBTi Target · 2030</div>
          <div className="text-[0.6vw] px-2 py-0.5 rounded-full bg-[#10b981]/15 text-[#10b981]">On track</div>
        </div>
        <div className="text-[1vw] text-white font-medium mb-3">Reduce Scope 1+2 by 42%</div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-2">
          <motion.div
            className="h-full bg-gradient-to-r from-[#10b981] to-[#0d9488]"
            initial={{ width: 0 }}
            animate={phase >= 2 ? { width: '64%' } : { width: 0 }}
            transition={{ duration: 1.4, delay: 0.5, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between text-[0.65vw] text-white/50">
          <span>27% achieved</span>
          <span>3.8 yrs ahead of plan</span>
        </div>
      </motion.div>

      {/* Top-right: Supplier audit panel */}
      <motion.div
        className="absolute top-[6vh] right-[4vw] z-10 w-[26vw] bg-[#0a1410]/90 backdrop-blur-md border border-[#10b981]/25 rounded-xl shadow-2xl shadow-emerald-900/40 overflow-hidden"
        initial={{ opacity: 0, x: 50, y: -20 }}
        animate={phase >= 2 ? { opacity: 1, x: 0, y: 0 } : { opacity: 0, x: 50, y: -20 }}
        transition={{ duration: 0.7, delay: 0.15, type: 'spring', stiffness: 100 }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
          <div className="text-[0.75vw] uppercase tracking-widest text-white/40">Supplier audits</div>
          <div className="text-[0.6vw] text-white/40">Auto-refreshed hourly</div>
        </div>
        {[
          { name: 'Bridgestone NZ', score: 'A', color: '#10b981' },
          { name: 'Z Energy', score: 'B+', color: '#10b981' },
          { name: 'Fonterra Logistics', score: 'C', color: '#d4af37' },
        ].map((s, i) => (
          <motion.div
            key={s.name}
            className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 last:border-0"
            initial={{ opacity: 0, x: 20 }}
            animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: 20 }}
            transition={{ duration: 0.4, delay: 0.4 + i * 0.12 }}
          >
            <div>
              <div className="text-[0.85vw] text-white/85 font-medium">{s.name}</div>
              <div className="text-[0.6vw] text-white/40">ESG audit · 14 questions</div>
            </div>
            <div className="text-[1.1vw] font-black" style={{ color: s.color }}>{s.score}</div>
          </motion.div>
        ))}
      </motion.div>

      {/* Bottom-left: PDF report preview */}
      <motion.div
        className="absolute bottom-[6vh] left-[6vw] z-10 w-[20vw] bg-[#fdfbf7] rounded-lg shadow-2xl shadow-black/60 overflow-hidden"
        initial={{ opacity: 0, y: 50, rotate: -8 }}
        animate={phase >= 2 ? { opacity: 1, y: 0, rotate: -4 } : { opacity: 0, y: 50, rotate: -8 }}
        transition={{ duration: 0.7, delay: 0.25, type: 'spring', stiffness: 90 }}
      >
        <div className="bg-[#0a1410] px-3 py-2 flex items-center justify-between">
          <div className="text-[0.65vw] text-[#10b981] uppercase tracking-widest font-bold">FY26 Annual Report</div>
          <div className="text-[0.55vw] text-white/40">PDF · 28 pages</div>
        </div>
        <div className="p-4 text-[#0a1410]">
          <div className="text-[0.55vw] uppercase tracking-widest text-[#10b981] font-bold mb-2">Sustainability Statement</div>
          <div className="text-[0.85vw] font-bold leading-tight mb-2">Kiwi Logistics Ltd · FY26</div>
          <div className="space-y-1">
            <div className="h-1.5 bg-[#0a1410]/15 rounded-full" />
            <div className="h-1.5 bg-[#0a1410]/15 rounded-full w-[90%]" />
            <div className="h-1.5 bg-[#0a1410]/15 rounded-full w-[80%]" />
            <div className="h-1.5 bg-[#0a1410]/15 rounded-full w-[95%]" />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[{ k: '1,240', v: 'tCO₂e' }, { k: '−18%', v: 'YoY' }, { k: 'A', v: 'Rating' }].map(s => (
              <div key={s.v} className="bg-[#10b981]/10 rounded p-1.5">
                <div className="text-[0.75vw] font-black text-[#10b981]">{s.k}</div>
                <div className="text-[0.45vw] uppercase tracking-widest text-[#0a1410]/60">{s.v}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Bottom-right: CRM API code snippet */}
      <motion.div
        className="absolute bottom-[6vh] right-[4vw] z-10 w-[26vw] bg-[#06100b]/95 backdrop-blur-md border border-[#10b981]/25 rounded-xl shadow-2xl shadow-emerald-900/40 overflow-hidden font-mono"
        initial={{ opacity: 0, y: 50 }}
        animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
        transition={{ duration: 0.7, delay: 0.35, type: 'spring', stiffness: 100 }}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-white/5">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400/60" />
            <div className="w-2 h-2 rounded-full bg-amber-300/60" />
            <div className="w-2 h-2 rounded-full bg-[#10b981]/60" />
          </div>
          <div className="text-[0.6vw] text-white/40 uppercase tracking-widest">CRM Integration · FGC v1</div>
        </div>
        <div className="p-4 text-[0.7vw] leading-relaxed">
          <div><span className="text-[#10b981]">POST</span> <span className="text-white/80">/api/v1/customers/123/footprint</span></div>
          <div className="text-white/40 mt-2">{`{`}</div>
          <div className="pl-3"><span className="text-[#d4af37]">"scope1"</span>: <span className="text-white">482</span>,</div>
          <div className="pl-3"><span className="text-[#d4af37]">"scope2"</span>: <span className="text-white">134</span>,</div>
          <div className="pl-3"><span className="text-[#d4af37]">"scope3"</span>: <span className="text-white">624</span>,</div>
          <div className="pl-3"><span className="text-[#d4af37]">"unit"</span>: <span className="text-[#10b981]">"tCO2e"</span></div>
          <div className="text-white/40">{`}`}</div>
          <div className="mt-2 text-[#10b981]">→ 200 OK · synced to HubSpot</div>
        </div>
      </motion.div>

      {/* Center: AI Advisor focus */}
      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
        <motion.div 
          className="w-[40vw] text-center bg-[#0a1410]/40 backdrop-blur-sm rounded-2xl py-8 px-6 border border-[#10b981]/20"
          initial={{ opacity: 0, y: 50, scale: 0.9 }}
          animate={phase >= 3 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 50, scale: 0.9 }}
          transition={{ duration: 1, delay: 0.3, type: 'spring' }}
        >
          <div className="inline-block px-4 py-1.5 bg-[#10b981]/20 text-[#10b981] rounded-full border border-[#10b981]/50 text-[0.85vw] font-bold tracking-widest uppercase mb-4">
            Built right in
          </div>
          <h2 className="text-[3.4vw] font-extrabold leading-tight mb-3">
            Targets. Suppliers. Reports. <span className="text-[#10b981]">CRM.</span>
          </h2>
          <p className="text-[1.4vw] text-[#e6e2d6]/75 font-light">
            One platform — no consultants stitching it together.
          </p>
        </motion.div>
      </div>
    </motion.div>
  );
}
