import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene3() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Title
      setTimeout(() => setPhase(2), 1500),  // Table header
      setTimeout(() => setPhase(3), 2500),  // Year 1
      setTimeout(() => setPhase(4), 3500),  // Year 2
      setTimeout(() => setPhase(5), 4500),  // Year 3
      setTimeout(() => setPhase(6), 6000),  // Highlight differentiator
      setTimeout(() => setPhase(7), 16500), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, y: -100, filter: 'blur(15px)' }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="text-center mb-[8vh] relative z-20">
        <motion.h2 
          className="text-[4vw] font-bold leading-tight"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.8 }}
        >
          Clear path to <span className="text-[#10b981]">Net Zero</span>.
        </motion.h2>
        <motion.p 
          className="text-[1.8vw] text-[#e6e2d6]/70 mt-4"
          initial={{ opacity: 0 }}
          animate={phase >= 1 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        >
          Multi-year CAPEX planner. Real ROI.
        </motion.p>
      </div>

      {/* Abstract Planner Table */}
      <div className="w-[70vw] relative z-20">
        
        {/* Headers */}
        <motion.div 
          className="flex border-b border-white/20 pb-4 mb-4 text-[1.2vw] font-semibold text-[#e6e2d6]/50 uppercase tracking-wider"
          initial={{ opacity: 0, x: -20 }}
          animate={phase >= 2 ? { opacity: 1, x: 0 } : { opacity: 0, x: -20 }}
          transition={{ duration: 0.6 }}
        >
          <div className="w-1/4">Timeline</div>
          <div className="w-1/4">Action</div>
          <div className="w-1/4 text-right">CAPEX</div>
          <div className="w-1/4 text-right text-[#10b981]">Savings</div>
        </motion.div>

        {/* Rows */}
        {[
          { year: 'Year 1', action: 'Lighting Upgrade', capex: '$12,500', savings: '$4,200/yr', phaseReq: 3 },
          { year: 'Year 2', action: 'Fleet EV Transition (3)', capex: '$180,000', savings: '$15,000/yr', phaseReq: 4 },
          { year: 'Year 3', action: 'Solar PV Install', capex: '$65,000', savings: '$12,800/yr', phaseReq: 5 },
        ].map((row, i) => (
          <motion.div 
            key={i}
            className="flex items-center border-b border-white/10 py-6 text-[1.6vw]"
            initial={{ opacity: 0, y: 20, backgroundColor: 'rgba(16,185,129,0)' }}
            animate={
              phase >= row.phaseReq 
                ? (phase >= 6 && i === 1 ? { opacity: 1, y: 0, backgroundColor: 'rgba(16,185,129,0.15)', scale: 1.02 } : { opacity: 1, y: 0, backgroundColor: 'rgba(16,185,129,0)', scale: 1 })
                : { opacity: 0, y: 20 }
            }
            transition={{ duration: 0.6, ease: "easeOut" }}
          >
            <div className="w-1/4 font-medium text-[#d4af37]">{row.year}</div>
            <div className="w-1/4">{row.action}</div>
            <div className="w-1/4 text-right text-white/80">{row.capex}</div>
            <div className="w-1/4 text-right text-[#10b981] font-bold">{row.savings}</div>
          </motion.div>
        ))}
      </div>

    </motion.div>
  );
}
