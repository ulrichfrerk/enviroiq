import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene2() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // UI appears
      setTimeout(() => setPhase(2), 1500),  // Stats populate
      setTimeout(() => setPhase(3), 3000),  // Sub-metrics
      setTimeout(() => setPhase(4), 5000),  // Headline
      setTimeout(() => setPhase(5), 13500), // Exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-between px-[10vw]"
      initial={{ opacity: 0, x: 100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -100, filter: 'blur(10px)' }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
    >
      
      {/* Left side text */}
      <div className="w-[35vw] relative z-20">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={phase >= 4 ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          <div className="text-[#d4af37] font-semibold tracking-widest uppercase mb-4 text-[1.2vw]">
            One Platform
          </div>
          <h2 className="text-[4.5vw] font-bold leading-[1.1] mb-6">
            Measure everything.
          </h2>
          <p className="text-[1.8vw] text-[#e6e2d6]/70 font-light">
            Scope 1, 2 & 3. Live NZ em6 grid intensity. Full ESG coverage.
          </p>
        </motion.div>
      </div>

      {/* Right side UI mockup abstraction */}
      <div className="w-[45vw] relative h-[60vh]">
        
        {/* Base UI Card */}
        <motion.div 
          className="absolute inset-0 bg-[#0d2116]/80 backdrop-blur-xl border border-[#10b981]/20 rounded-3xl p-8 shadow-2xl shadow-[#10b981]/10 flex flex-col"
          initial={{ opacity: 0, scale: 0.9, rotateY: 20 }}
          animate={phase >= 1 ? { opacity: 1, scale: 1, rotateY: 0 } : { opacity: 0, scale: 0.9, rotateY: 20 }}
          transition={{ duration: 1.2, type: "spring", stiffness: 100, damping: 20 }}
          style={{ transformPerspective: 1000 }}
        >
          {/* Header */}
          <div className="flex justify-between items-center mb-12 border-b border-white/10 pb-6">
            <div className="w-1/3 h-4 bg-white/10 rounded-full" />
            <div className="w-16 h-8 bg-[#10b981]/20 rounded-full" />
          </div>

          {/* Main Stat */}
          <div className="flex flex-col items-center justify-center flex-1">
            <motion.div 
              className="text-[#10b981] text-[6vw] font-black leading-none mb-2"
              initial={{ opacity: 0, y: 20 }}
              animate={phase >= 2 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.8, delay: 0.2 }}
            >
              1,240
            </motion.div>
            <motion.div 
              className="text-[#e6e2d6]/60 text-[1.5vw] tracking-wider uppercase"
              initial={{ opacity: 0 }}
              animate={phase >= 2 ? { opacity: 1 } : { opacity: 0 }}
              transition={{ duration: 0.8, delay: 0.4 }}
            >
              tCO2e Total
            </motion.div>
          </div>

          {/* Bar charts */}
          <div className="flex justify-between items-end h-[15vh] mt-auto gap-4">
            {[40, 70, 30, 90, 60].map((h, i) => (
              <motion.div 
                key={i}
                className="w-full bg-gradient-to-t from-[#10b981] to-[#0d9488] rounded-t-sm"
                initial={{ height: 0 }}
                animate={phase >= 3 ? { height: `${h}%` } : { height: 0 }}
                transition={{ duration: 1, delay: 0.1 * i, type: "spring" }}
              />
            ))}
          </div>

        </motion.div>
        
        {/* Floating motif image */}
        <motion.img 
          src={`${import.meta.env.BASE_URL}images/dashboard_motif.png`}
          className="absolute -right-12 -bottom-12 w-[25vw] rounded-2xl shadow-2xl border border-white/5"
          initial={{ opacity: 0, y: 50, scale: 0.8 }}
          animate={phase >= 3 ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 50, scale: 0.8 }}
          transition={{ duration: 1.2, delay: 0.5, type: "spring", stiffness: 80 }}
        />

      </div>

    </motion.div>
  );
}
