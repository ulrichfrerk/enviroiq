import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export function Scene1() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Text 1
      setTimeout(() => setPhase(2), 2500),  // Text 2
      setTimeout(() => setPhase(3), 4500),  // Text 3
      setTimeout(() => setPhase(4), 7000),  // Main Hook
      setTimeout(() => setPhase(5), 10500), // Exit drift
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  return (
    <motion.div 
      className="absolute inset-0 flex items-center justify-center overflow-hidden"
      initial={{ opacity: 0, scale: 1.1 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(20px)' }}
      transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Background Video */}
      <div className="absolute inset-0 z-0 opacity-60 mix-blend-screen">
        <video 
          src={`${import.meta.env.BASE_URL}videos/nz_forest.mp4`}
          autoPlay muted loop playsInline
          className="w-full h-full object-cover"
        />
      </div>

      {/* Grid overlay for texture */}
      <div 
        className="absolute inset-0 z-0 opacity-20"
        style={{ 
          backgroundImage: `linear-gradient(rgba(16, 185, 129, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(16, 185, 129, 0.1) 1px, transparent 1px)`,
          backgroundSize: '40px 40px' 
        }} 
      />

      <div className="relative z-10 w-full max-w-[80vw] mx-auto text-center flex flex-col items-center justify-center">
        
        {/* Rapid fire problem statements */}
        <div className="h-[20vh] flex items-center justify-center mb-8 relative w-full">
          <AnimatePresence mode="popLayout">
            {phase === 1 && (
              <motion.div
                key="p1"
                initial={{ opacity: 0, y: 20, rotateX: -20 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                exit={{ opacity: 0, y: -20, rotateX: 20 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute text-[3vw] font-bold text-[#e6e2d6]/80 tracking-wide uppercase"
              >
                CARBON REDUCTION ACT
              </motion.div>
            )}
            {phase === 2 && (
              <motion.div
                key="p2"
                initial={{ opacity: 0, y: 20, rotateX: -20 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                exit={{ opacity: 0, y: -20, rotateX: 20 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute text-[3vw] font-bold text-[#e6e2d6]/80 tracking-wide uppercase"
              >
                NZ ETS PRICING
              </motion.div>
            )}
            {phase === 3 && (
              <motion.div
                key="p3"
                initial={{ opacity: 0, y: 20, rotateX: -20 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                exit={{ opacity: 0, y: -20, rotateX: 20 }}
                transition={{ duration: 0.6, ease: "easeOut" }}
                className="absolute text-[3vw] font-bold text-[#e6e2d6]/80 tracking-wide uppercase"
              >
                SUPPLIER ESG AUDITS
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Main Hook */}
        <motion.div
          className="relative"
          initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
          animate={phase >= 4 ? { opacity: 1, scale: 1, filter: 'blur(0px)' } : { opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <h1 className="text-[6vw] font-extrabold tracking-tight leading-[1.1] mb-6">
            The rules have changed. <br/>
            <span className="text-[#10b981]">Are you ready?</span>
          </h1>
          
          <motion.div 
            className="w-[10vw] h-[4px] bg-[#d4af37] mx-auto rounded-full"
            initial={{ width: 0 }}
            animate={phase >= 4 ? { width: '10vw' } : { width: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          />
        </motion.div>

      </div>
    </motion.div>
  );
}
