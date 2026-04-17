import { motion, AnimatePresence } from 'framer-motion';
import { useVideoPlayer } from '@/lib/video';
import { Scene1 } from './video_scenes/Scene1';
import { Scene2 } from './video_scenes/Scene2';
import { Scene3 } from './video_scenes/Scene3';
import { Scene4 } from './video_scenes/Scene4';
import { Scene5 } from './video_scenes/Scene5';

const SCENE_DURATIONS = { open: 12000, build1: 15000, build2: 18000, build3: 15000, close: 10000 };

export default function VideoTemplate() {
  const { currentScene } = useVideoPlayer({ durations: SCENE_DURATIONS });

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#0a110d] text-[#fdfbf7]">
      {/* Persistent Background Layer */}
      <div className="absolute inset-0 z-0">
        <motion.div 
          className="absolute inset-0 opacity-40 mix-blend-overlay"
          style={{ backgroundImage: `url(${import.meta.env.BASE_URL}images/bg_texture.png)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
          animate={{
            scale: [1, 1.05, 1],
            x: ['0%', '-2%', '0%'],
          }}
          transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
        />
        
        {/* Floating gradient orb 1 */}
        <motion.div 
          className="absolute w-[80vw] h-[80vw] rounded-full blur-[100px] opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #10b981 0%, transparent 70%)' }}
          animate={{
            x: currentScene === 0 ? '-20vw' : currentScene === 1 ? '50vw' : currentScene === 2 ? '10vw' : '40vw',
            y: currentScene === 0 ? '10vh' : currentScene === 1 ? '-20vh' : currentScene === 2 ? '50vh' : '20vh',
            scale: currentScene === 4 ? 1.5 : 1,
          }}
          transition={{ duration: 4, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Floating gradient orb 2 */}
        <motion.div 
          className="absolute w-[60vw] h-[60vw] rounded-full blur-[80px] opacity-10 pointer-events-none"
          style={{ background: 'radial-gradient(circle, #0d9488 0%, transparent 70%)' }}
          animate={{
            x: currentScene === 0 ? '50vw' : currentScene === 1 ? '-10vw' : currentScene === 2 ? '60vw' : '10vw',
            y: currentScene === 0 ? '50vh' : currentScene === 1 ? '80vh' : currentScene === 2 ? '10vh' : '60vh',
          }}
          transition={{ duration: 5, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Foreground Content */}
      <div className="relative z-10 w-full h-full">
        <AnimatePresence mode="popLayout">
          {currentScene === 0 && <Scene1 key="open" />}
          {currentScene === 1 && <Scene2 key="build1" />}
          {currentScene === 2 && <Scene3 key="build2" />}
          {currentScene === 3 && <Scene4 key="build3" />}
          {currentScene === 4 && <Scene5 key="close" />}
        </AnimatePresence>
      </div>
    </div>
  );
}
