import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

export function Scene4() {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 500),   // Grid lines
      setTimeout(() => setPhase(2), 1500),  // Items appear
      setTimeout(() => setPhase(3), 3500),  // Center focus
      setTimeout(() => setPhase(4), 13500), // Exit
    ];
    return () => timers.forEach(t => clearTimeout(t));
  }, []);

  const features = [
    { title: "SBTi Targets", subtitle: "Aligned to 1.5°C", pos: "top-10 left-[15%]" },
    { title: "Supplier Audits", subtitle: "Automated tracking", pos: "top-[20%] right-[15%]" },
    { title: "PDF Reports", subtitle: "Server-side generation", pos: "bottom-[20%] left-[20%]" },
    { title: "CRM API", subtitle: "Seamless integration", pos: "bottom-10 right-[25%]" }
  ];

  return (
    <motion.div 
      className="absolute inset-0 overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.5, filter: 'blur(20px)' }}
      transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Background Data Grid Video */}
      <div className="absolute inset-0 z-0 opacity-40 mix-blend-screen">
        <video 
          src={`${import.meta.env.BASE_URL}videos/data_grid.mp4`}
          autoPlay muted loop playsInline
          className="w-full h-full object-cover"
        />
      </div>

      {/* Floating feature nodes */}
      {features.map((f, i) => (
        <motion.div
          key={i}
          className={`absolute ${f.pos} z-10 bg-[#0a110d]/80 backdrop-blur-md border border-[#10b981]/30 rounded-xl p-6 shadow-xl shadow-[#10b981]/5`}
          initial={{ opacity: 0, scale: 0.5 }}
          animate={phase >= 2 ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.5 }}
          transition={{ duration: 0.8, delay: i * 0.2, type: "spring", stiffness: 100 }}
        >
          <div className="w-3 h-3 bg-[#d4af37] rounded-full mb-3" />
          <h3 className="text-[1.5vw] font-bold">{f.title}</h3>
          <p className="text-[1vw] text-[#e6e2d6]/60">{f.subtitle}</p>
        </motion.div>
      ))}

      {/* Center piece: AI Advisor */}
      <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
        <motion.div 
          className="w-[40vw] text-center"
          initial={{ opacity: 0, y: 50 }}
          animate={phase >= 3 ? { opacity: 1, y: 0 } : { opacity: 0, y: 50 }}
          transition={{ duration: 1, delay: 0.5, type: "spring" }}
        >
          <div className="inline-block px-6 py-2 bg-[#10b981]/20 text-[#10b981] rounded-full border border-[#10b981]/50 text-[1vw] font-bold tracking-widest uppercase mb-6">
            AI ESG Advisor
          </div>
          <h2 className="text-[4vw] font-extrabold leading-tight mb-4">
            "What should I do next?"
          </h2>
          <p className="text-[1.8vw] text-[#e6e2d6]/80 font-light">
            Actionable intelligence, built right in.
          </p>
        </motion.div>
      </div>

    </motion.div>
  );
}
