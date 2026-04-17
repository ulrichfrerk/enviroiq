import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

type Horizon = 'conservative' | 'moderate' | 'aggressive';

const PLANS: Record<Horizon, { years: number; capex: number; savings: number; payback: number; cuts: number; rows: { year: string; action: string; capex: string; savings: string; co2: string }[] }> = {
  conservative: {
    years: 7, capex: 184500, savings: 24800, payback: 7.4, cuts: 38,
    rows: [
      { year: 'FY26', action: 'LED retrofit · Auckland depot', capex: '$12,500', savings: '$4,200/yr', co2: '−6 tCO₂e' },
      { year: 'FY27', action: 'Behavioural fleet program', capex: '$3,800', savings: '$2,900/yr', co2: '−4 tCO₂e' },
      { year: 'FY28', action: 'Replace 1× ICE ute with EV', capex: '$58,000', savings: '$5,100/yr', co2: '−8 tCO₂e' },
    ],
  },
  moderate: {
    years: 5, capex: 312000, savings: 48200, payback: 5.1, cuts: 56,
    rows: [
      { year: 'FY26', action: 'LED retrofit · Auckland depot', capex: '$12,500', savings: '$4,200/yr', co2: '−6 tCO₂e' },
      { year: 'FY27', action: 'Fleet EV transition (3 utes)', capex: '$180,000', savings: '$15,000/yr', co2: '−24 tCO₂e' },
      { year: 'FY28', action: 'Solar PV · 40 kW rooftop', capex: '$65,000', savings: '$12,800/yr', co2: '−14 tCO₂e' },
    ],
  },
  aggressive: {
    years: 3, capex: 524000, savings: 92400, payback: 3.6, cuts: 78,
    rows: [
      { year: 'FY26', action: 'LED + heat pumps + controls', capex: '$48,000', savings: '$11,200/yr', co2: '−12 tCO₂e' },
      { year: 'FY27', action: 'Full fleet EV (8 vehicles)', capex: '$380,000', savings: '$58,000/yr', co2: '−42 tCO₂e' },
      { year: 'FY28', action: 'Solar PV + battery storage', capex: '$96,000', savings: '$23,200/yr', co2: '−24 tCO₂e' },
    ],
  },
};

function Counter({ to, phase, trigger, prefix = '', suffix = '', decimals = 0, duration = 1000 }: { to: number; phase: number; trigger: number; prefix?: string; suffix?: string; decimals?: number; duration?: number }) {
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
  return <>{prefix}{val.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}{suffix}</>;
}

export function Scene3() {
  const [phase, setPhase] = useState(0);
  const [horizon, setHorizon] = useState<Horizon>('conservative');

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 400),
      setTimeout(() => setPhase(2), 1300),
      setTimeout(() => setPhase(3), 2400),   // rows reveal (conservative)
      setTimeout(() => setPhase(4), 5200),   // cursor moves to "Aggressive"
      setTimeout(() => { setHorizon('aggressive'); setPhase(5); }, 6300),
      setTimeout(() => setPhase(6), 9500),   // headline
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const plan = PLANS[horizon];

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center px-[4vw]"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -60, filter: 'blur(12px)' }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* App shell */}
      <motion.div 
        className="relative w-[92vw] h-[80vh] bg-[#0a1410] border border-[#10b981]/15 rounded-2xl shadow-2xl shadow-emerald-900/40 overflow-hidden flex flex-col"
        initial={{ opacity: 0, scale: 0.94, y: 30 }}
        animate={phase >= 1 ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.94, y: 30 }}
        transition={{ duration: 0.8, type: 'spring', stiffness: 90, damping: 18 }}
      >
        {/* Top bar */}
        <div className="h-[5vh] border-b border-white/5 flex items-center justify-between px-6">
          <div className="text-[1vw] text-white/80 font-medium">
            Recommendations <span className="text-white/30 mx-2">›</span>
            <span className="text-white/40">Multi-year capex planner</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[0.7vw] text-white/40">Aligned to</div>
            <div className="text-[0.75vw] px-2 py-1 rounded bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/30">SBTi 1.5°C · 2030</div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 p-6 flex flex-col gap-4">
          {/* Horizon pills */}
          <motion.div
            className="flex items-center gap-3 relative"
            initial={{ opacity: 0, y: 10 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.5 }}
          >
            <div className="text-[0.75vw] text-white/40 uppercase tracking-widest mr-2">Horizon</div>
            {(['conservative', 'moderate', 'aggressive'] as Horizon[]).map(h => (
              <motion.div
                key={h}
                className={`px-4 py-2 rounded-full text-[0.85vw] font-semibold border transition-colors ${
                  horizon === h
                    ? 'bg-[#10b981]/20 text-[#10b981] border-[#10b981]/50'
                    : 'bg-white/5 text-white/50 border-white/10'
                }`}
                animate={horizon === h ? { scale: [1, 1.05, 1] } : { scale: 1 }}
                transition={{ duration: 0.4 }}
              >
                {h === 'conservative' && `Conservative · 7yr`}
                {h === 'moderate' && `Moderate · 5yr`}
                {h === 'aggressive' && `Aggressive · 3yr`}
              </motion.div>
            ))}

            {/* Animated cursor */}
            <motion.div
              className="absolute z-30 pointer-events-none"
              initial={{ left: '12%', top: '120%', opacity: 0 }}
              animate={
                phase >= 5
                  ? { left: '38%', top: '50%', opacity: 1 }
                  : phase >= 4
                  ? { left: '38%', top: '50%', opacity: 1 }
                  : phase >= 3
                  ? { left: '12%', top: '120%', opacity: 1 }
                  : { opacity: 0 }
              }
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="#fdfbf7" stroke="#06100b" strokeWidth="1">
                <path d="M3 2 L3 18 L7 14 L10 21 L13 20 L10 13 L17 13 Z" />
              </svg>
            </motion.div>
          </motion.div>

          {/* Summary metrics */}
          <motion.div
            className="grid grid-cols-4 gap-4"
            initial={{ opacity: 0, y: 10 }}
            animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            <div className="bg-[#0d2116]/70 border border-white/5 rounded-xl p-4">
              <div className="text-[0.7vw] text-white/40 uppercase tracking-widest mb-2">Total CAPEX</div>
              <div className="text-[1.8vw] font-black text-white">
                <Counter to={plan.capex} phase={phase} trigger={2} prefix="$" />
              </div>
              <div className="text-[0.65vw] text-white/40 mt-1">Across {plan.years} years</div>
            </div>
            <div className="bg-[#0d2116]/70 border border-white/5 rounded-xl p-4">
              <div className="text-[0.7vw] text-white/40 uppercase tracking-widest mb-2">Annual savings</div>
              <div className="text-[1.8vw] font-black text-[#10b981]">
                <Counter to={plan.savings} phase={phase} trigger={2} prefix="$" />
              </div>
              <div className="text-[0.65vw] text-white/40 mt-1">At steady state</div>
            </div>
            <div className="bg-[#0d2116]/70 border border-white/5 rounded-xl p-4">
              <div className="text-[0.7vw] text-white/40 uppercase tracking-widest mb-2">Payback</div>
              <div className="text-[1.8vw] font-black text-white">
                <Counter to={plan.payback} phase={phase} trigger={2} decimals={1} suffix=" yrs" />
              </div>
              <div className="text-[0.65vw] text-white/40 mt-1">Weighted avg, after rebates</div>
            </div>
            <div className="bg-gradient-to-br from-[#d4af37]/15 to-[#0d2116]/70 border border-[#d4af37]/30 rounded-xl p-4">
              <div className="text-[0.7vw] text-[#d4af37] uppercase tracking-widest mb-2">Emissions cut</div>
              <div className="text-[1.8vw] font-black text-[#d4af37]">
                <Counter to={plan.cuts} phase={phase} trigger={2} suffix="%" />
              </div>
              <div className="text-[0.65vw] text-white/50 mt-1">vs FY25 baseline</div>
            </div>
          </motion.div>

          {/* Year table */}
          <div className="flex-1 bg-[#0d2116]/40 border border-white/5 rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 px-5 py-3 text-[0.7vw] uppercase tracking-widest text-white/40 border-b border-white/5 bg-black/20">
              <div className="col-span-1">Year</div>
              <div className="col-span-5">Action</div>
              <div className="col-span-2 text-right">CAPEX</div>
              <div className="col-span-2 text-right">Savings</div>
              <div className="col-span-2 text-right">Avoided</div>
            </div>
            {plan.rows.map((row, i) => (
              <motion.div
                key={`${horizon}-${i}`}
                className="grid grid-cols-12 px-5 py-4 text-[1vw] items-center border-b border-white/5 hover:bg-white/5"
                initial={{ opacity: 0, x: -30 }}
                animate={phase >= 3 ? { opacity: 1, x: 0 } : { opacity: 0, x: -30 }}
                transition={{ duration: 0.5, delay: 0.1 + i * 0.15 }}
              >
                <div className="col-span-1 font-bold text-[#d4af37]">{row.year}</div>
                <div className="col-span-5 text-white/85">{row.action}</div>
                <div className="col-span-2 text-right text-white/70 font-mono">{row.capex}</div>
                <div className="col-span-2 text-right text-[#10b981] font-mono font-semibold">{row.savings}</div>
                <div className="col-span-2 text-right text-white/60 font-mono">{row.co2}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Headline overlay */}
      <motion.div
        className="absolute top-[5vh] left-1/2 -translate-x-1/2 text-center pointer-events-none z-30"
        initial={{ opacity: 0, y: -20 }}
        animate={phase >= 6 ? { opacity: 1, y: 0 } : { opacity: 0, y: -20 }}
        transition={{ duration: 0.8 }}
      >
        <div className="text-[#d4af37] font-semibold tracking-widest uppercase text-[0.9vw]">The differentiator</div>
        <h2 className="text-[2.6vw] font-bold leading-tight mt-1">
          A <span className="text-[#10b981]">multi-year capex plan</span> — not just a number.
        </h2>
      </motion.div>
    </motion.div>
  );
}
