import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

const NAV = [
  { label: 'Dashboard', active: true },
  { label: 'Energy' },
  { label: 'Fleet' },
  { label: 'Waste' },
  { label: 'Targets' },
  { label: 'Suppliers' },
  { label: 'Advisor' },
  { label: 'Reports' },
];

function Counter({ to, phase, trigger, suffix = '', decimals = 0, duration = 1200 }: { to: number; phase: number; trigger: number; suffix?: string; decimals?: number; duration?: number }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (phase < trigger) { setVal(0); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(to * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, trigger, to, duration]);
  return <>{val.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}</>;
}

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),    // chrome appears
      setTimeout(() => setPhase(2), 1200),   // metric cards populate
      setTimeout(() => setPhase(3), 2400),   // chart draws
      setTimeout(() => setPhase(4), 3600),   // grid widget pulses in
      setTimeout(() => setPhase(5), 4800),   // headline overlay
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center px-[4vw]"
      initial={{ opacity: 0, x: 80 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -80, filter: 'blur(10px)' }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Browser chrome / app shell */}
      <motion.div 
        className="relative w-[92vw] h-[80vh] bg-[#0a1410] border border-[#10b981]/15 rounded-2xl shadow-2xl shadow-emerald-900/40 overflow-hidden flex"
        initial={{ opacity: 0, scale: 0.92, y: 40 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.92, y: 40 }}
        transition={{ duration: 0.9, type: 'spring', stiffness: 90, damping: 18 }}
      >
        {/* Sidebar */}
        <div className="w-[14vw] bg-[#06100b] border-r border-white/5 flex flex-col py-5 px-3">
          <div className="flex items-center gap-2 px-3 mb-8">
            <div className="w-7 h-7 rounded-lg bg-[#10b981] flex items-center justify-center text-[#06100b] font-black text-sm">E</div>
            <div>
              <div className="text-[1vw] font-bold tracking-tight leading-none">EnviroIQ</div>
              <div className="text-[0.55vw] text-[#10b981] tracking-widest uppercase mt-1">Live</div>
            </div>
          </div>
          {NAV.map((n, i) => (
            <motion.div
              key={n.label}
              className={`px-3 py-2 rounded-lg text-[0.85vw] mb-1 ${n.active ? 'bg-[#10b981]/15 text-[#10b981] font-semibold' : 'text-white/50'}`}
              initial={{ opacity: 0, x: -10 }}
              animate={phase >= 1 ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
              transition={{ delay: 0.1 + i * 0.04, duration: 0.4 }}
            >
              {n.label}
            </motion.div>
          ))}
        </div>

        {/* Main content */}
        <div className="flex-1 flex flex-col">
          {/* Top bar */}
          <div className="h-[5vh] border-b border-white/5 flex items-center justify-between px-6">
            <div className="text-[1vw] text-white/80 font-medium">Dashboard <span className="text-white/30 mx-2">›</span> <span className="text-white/40">All Scopes · FY26</span></div>
            <div className="flex items-center gap-3">
              <div className="text-[0.75vw] text-white/40">Kiwi Logistics Ltd</div>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#10b981] to-[#0d9488]" />
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 p-6 grid grid-cols-12 grid-rows-6 gap-4">
            {/* Scope 1 */}
            <motion.div
              className="col-span-3 row-span-2 bg-[#0d2116]/70 border border-white/5 rounded-xl p-4 flex flex-col justify-between"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.05, duration: 0.6 }}
            >
              <div className="flex items-center justify-between">
                <div className="text-[0.7vw] text-white/40 uppercase tracking-widest">Scope 1</div>
                <div className="text-[0.65vw] text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded-full">−12%</div>
              </div>
              <div>
                <div className="text-[2.4vw] font-black text-white leading-none">
                  <Counter to={482} phase={phase} trigger={2} /> <span className="text-[0.9vw] text-white/40 font-normal">tCO₂e</span>
                </div>
                <div className="text-[0.7vw] text-white/40 mt-1">Fleet · LPG · Refrigerants</div>
              </div>
            </motion.div>

            {/* Scope 2 */}
            <motion.div
              className="col-span-3 row-span-2 bg-[#0d2116]/70 border border-white/5 rounded-xl p-4 flex flex-col justify-between"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.15, duration: 0.6 }}
            >
              <div className="flex items-center justify-between">
                <div className="text-[0.7vw] text-white/40 uppercase tracking-widest">Scope 2</div>
                <div className="text-[0.65vw] text-[#10b981] bg-[#10b981]/10 px-2 py-0.5 rounded-full">−28%</div>
              </div>
              <div>
                <div className="text-[2.4vw] font-black text-white leading-none">
                  <Counter to={134} phase={phase} trigger={2} /> <span className="text-[0.9vw] text-white/40 font-normal">tCO₂e</span>
                </div>
                <div className="text-[0.7vw] text-white/40 mt-1">Grid electricity · em6 live</div>
              </div>
            </motion.div>

            {/* Scope 3 */}
            <motion.div
              className="col-span-3 row-span-2 bg-[#0d2116]/70 border border-white/5 rounded-xl p-4 flex flex-col justify-between"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.25, duration: 0.6 }}
            >
              <div className="flex items-center justify-between">
                <div className="text-[0.7vw] text-white/40 uppercase tracking-widest">Scope 3</div>
                <div className="text-[0.65vw] text-amber-300 bg-amber-300/10 px-2 py-0.5 rounded-full">+3%</div>
              </div>
              <div>
                <div className="text-[2.4vw] font-black text-white leading-none">
                  <Counter to={624} phase={phase} trigger={2} /> <span className="text-[0.9vw] text-white/40 font-normal">tCO₂e</span>
                </div>
                <div className="text-[0.7vw] text-white/40 mt-1">Suppliers · Travel · Waste</div>
              </div>
            </motion.div>

            {/* em6 NZ Grid live widget */}
            <motion.div
              className="col-span-3 row-span-2 bg-gradient-to-br from-[#10b981]/15 to-[#0d2116]/80 border border-[#10b981]/30 rounded-xl p-4 flex flex-col justify-between relative overflow-hidden"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={phase >= 4 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.9 }}
              transition={{ delay: 0.05, duration: 0.6, type: 'spring', stiffness: 110 }}
            >
              <div className="flex items-center justify-between">
                <div className="text-[0.7vw] text-[#10b981] uppercase tracking-widest font-bold">em6 NZ Grid</div>
                <motion.div
                  className="w-2 h-2 rounded-full bg-[#10b981]"
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1.4, repeat: Infinity }}
                />
              </div>
              <div>
                <div className="text-[2.2vw] font-black text-[#10b981] leading-none">
                  <Counter to={46.4} phase={phase} trigger={4} decimals={1} /> <span className="text-[0.8vw] text-white/50 font-normal">gCO₂/kWh</span>
                </div>
                <div className="text-[0.75vw] text-white/60 mt-1">
                  <Counter to={93.4} phase={phase} trigger={4} decimals={1} suffix="%" /> renewable · updated now
                </div>
              </div>
            </motion.div>

            {/* Emissions trend chart */}
            <motion.div
              className="col-span-8 row-span-4 bg-[#0d2116]/70 border border-white/5 rounded-xl p-4 flex flex-col"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.7 }}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-[0.95vw] font-semibold">Total emissions · 12 months</div>
                  <div className="text-[0.7vw] text-white/40">tCO₂e per month, scope-stacked</div>
                </div>
                <div className="flex gap-2 text-[0.65vw]">
                  <div className="flex items-center gap-1 text-white/60"><div className="w-2 h-2 rounded-full bg-[#10b981]" />Scope 1</div>
                  <div className="flex items-center gap-1 text-white/60"><div className="w-2 h-2 rounded-full bg-[#0d9488]" />Scope 2</div>
                  <div className="flex items-center gap-1 text-white/60"><div className="w-2 h-2 rounded-full bg-[#d4af37]" />Scope 3</div>
                </div>
              </div>
              <div className="flex-1 relative">
                <svg viewBox="0 0 600 200" className="w-full h-full" preserveAspectRatio="none">
                  {/* grid lines */}
                  {[0, 1, 2, 3].map(i => (
                    <line key={i} x1="0" x2="600" y1={i * 50 + 10} y2={i * 50 + 10} stroke="rgba(255,255,255,0.05)" />
                  ))}
                  {/* Stacked area: scope 3 (top), scope 2, scope 1 */}
                  {(() => {
                    const months = 12;
                    const s1 = [55, 52, 50, 48, 47, 45, 44, 42, 41, 40, 38, 36];
                    const s2 = [22, 21, 19, 18, 17, 15, 14, 13, 12, 11, 11, 10];
                    const s3 = [50, 51, 52, 50, 51, 53, 52, 53, 54, 53, 54, 55];
                    const stepX = 600 / (months - 1);
                    const scale = 1.4;
                    const path = (vals: number[], baseline: number[]) => {
                      const pts: string[] = [];
                      for (let i = 0; i < months; i++) pts.push(`${i * stepX},${190 - (vals[i] + baseline[i]) * scale}`);
                      for (let i = months - 1; i >= 0; i--) pts.push(`${i * stepX},${190 - baseline[i] * scale}`);
                      return `M ${pts.join(' L ')} Z`;
                    };
                    const z = Array(months).fill(0);
                    return (
                      <g>
                        <motion.path d={path(s1, z)} fill="#10b981" fillOpacity="0.7" initial={{ opacity: 0 }} animate={phase >= 3 ? { opacity: 0.7 } : { opacity: 0 }} transition={{ duration: 0.8 }} />
                        <motion.path d={path(s2, s1)} fill="#0d9488" fillOpacity="0.7" initial={{ opacity: 0 }} animate={phase >= 3 ? { opacity: 0.7 } : { opacity: 0 }} transition={{ duration: 0.8, delay: 0.15 }} />
                        <motion.path d={path(s3, s1.map((v, i) => v + s2[i]))} fill="#d4af37" fillOpacity="0.55" initial={{ opacity: 0 }} animate={phase >= 3 ? { opacity: 0.55 } : { opacity: 0 }} transition={{ duration: 0.8, delay: 0.3 }} />
                        {/* target glide line */}
                        <motion.line
                          x1="0" y1="100" x2="600" y2="40"
                          stroke="#fdfbf7" strokeWidth="1.5" strokeDasharray="4 4"
                          initial={{ pathLength: 0 }}
                          animate={phase >= 3 ? { pathLength: 1 } : { pathLength: 0 }}
                          transition={{ duration: 1.2, delay: 0.5 }}
                        />
                      </g>
                    );
                  })()}
                </svg>
                <div className="absolute right-2 top-1 text-[0.6vw] text-white/40">SBTi 1.5°C glidepath</div>
              </div>
            </motion.div>

            {/* AI Advisor card */}
            <motion.div
              className="col-span-4 row-span-2 bg-[#0d2116]/70 border border-[#d4af37]/20 rounded-xl p-4 flex flex-col justify-between"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ delay: 0.4, duration: 0.6 }}
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-[#d4af37]/20 border border-[#d4af37]/40 flex items-center justify-center text-[0.7vw] text-[#d4af37] font-bold">AI</div>
                <div className="text-[0.8vw] font-semibold">ESG Advisor</div>
              </div>
              <div className="text-[0.85vw] text-white/80 leading-snug">
                "Switch your Auckland depot to off-peak charging — saves <span className="text-[#10b981] font-semibold">~3.2 tCO₂e/yr</span> with no capex."
              </div>
              <div className="flex gap-2">
                <div className="text-[0.65vw] px-2 py-1 rounded bg-[#10b981]/15 text-[#10b981]">Apply</div>
                <div className="text-[0.65vw] px-2 py-1 rounded bg-white/5 text-white/50">Snooze</div>
              </div>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Headline overlay */}
      <motion.div
        className="absolute top-[6vh] left-1/2 -translate-x-1/2 text-center pointer-events-none z-30"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 5 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-[#d4af37] font-semibold tracking-widest uppercase text-[0.9vw]">One Platform</div>
        <h2 className="text-[2.6vw] font-bold leading-tight mt-1">
          Measure everything. <span className="text-[#10b981]">Live.</span>
        </h2>
      </motion.div>
    </motion.div>
  );
}
