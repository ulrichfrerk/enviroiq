import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene5() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Tagline
      setTimeout(() => setPhase(2), 2500),  // Logo / Name
      setTimeout(() => setPhase(3), 4000),  // URL
      setTimeout(() => setPhase(4), 8500), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex flex-col items-center justify-center bg-[#0a110d]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.5 }}
    >
      
      <div className="relative z-20 text-center">
        
        <motion.div
          className="text-[#d4af37] text-[2vw] font-medium tracking-widest uppercase mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={phase >= 1 ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 1, ease: "easeOut" }}
        >
          ESG without the consultant tax
        </motion.div>

        <motion.h1 
          className="text-[8vw] font-black tracking-tighter text-white mb-6 leading-none flex items-center justify-center gap-4"
          initial={{ opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          animate={phase >= 2 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.9, filter: 'blur(10px)' }}
          transition={{ duration: 1.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="w-[1em] h-[1em] bg-gradient-to-br from-[#10b981] to-[#0d9488] rounded-xl flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.4)]">
             {/* Abstract logo mark */}
             <div className="w-1/2 h-1/2 bg-white rounded-sm rotate-45 transform" />
          </div>
          EnviroIQ
        </motion.h1>

        <motion.div
          className="text-[2.5vw] text-[#10b981] font-semibold tracking-wide"
          initial={{ opacity: 0 }}
          animate={phase >= 3 ? { opacity: 1 } : { opacity: 0 }}
          transition={{ duration: 1, delay: 0.5 }}
        >
          enviroiq.net
        </motion.div>

      </div>

    </motion.div>
  );
}
