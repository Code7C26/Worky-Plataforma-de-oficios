import { motion } from 'framer-motion';
import logo from '@assets/worky-logo.png';

const EASE = [0.22, 1, 0.36, 1] as const;

export function Scene4() {
  return (
    <motion.section
      className="film paper-grain"
      style={{ background: '#f9f6f0', color: '#203655' }}
      initial={{ clipPath: 'circle(0% at 75% 32%)' }}
      animate={{ clipPath: 'circle(140% at 75% 32%)' }}
      exit={{ clipPath: 'circle(0% at 28% 65%)', opacity: 0, transition: { duration: 0.42, ease: EASE } }}
      transition={{ duration: 0.45, ease: EASE }}
    >
      <motion.div className="display" style={{ position: 'absolute', left: '7%', top: '12%', fontSize: '10vmin', lineHeight: .88, letterSpacing: '-.075em', zIndex: 2 }}
        initial={{ opacity: 0, x: -28 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1, duration: 0.3, ease: EASE }}>
        PROBLEM
      </motion.div>
      <motion.div className="display" style={{ position: 'absolute', left: '7%', top: '23%', fontSize: '12vmin', lineHeight: .86, letterSpacing: '-.08em', color: '#f58224', zIndex: 2 }}
        initial={{ opacity: 0, scale: .6, rotate: -3 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ delay: 0.55, duration: .35, ease: EASE }}>
        SOLVED.
      </motion.div>

      <motion.svg viewBox="0 0 460 460" style={{ position: 'absolute', width: '76vmin', height: '76vmin', right: '-18%', top: '11%', zIndex: 1, overflow: 'visible' }} aria-hidden="true">
        <motion.circle cx="230" cy="230" r="177" fill="#f8c859" initial={{ scale: 0, transformOrigin: 'center' }} animate={{ scale: [0, 1.05, 1] }} transition={{ delay: 0.06, duration: 0.62, ease: EASE }} />
        <motion.path d="M95 238 L190 328 L368 126" fill="none" stroke="#f58224" strokeWidth="45" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.05, duration: 0.76, ease: EASE }} />
        <motion.path d="M230 54 C174 54 130 96 130 150 C130 228 230 350 230 350 C230 350 330 228 330 150 C330 96 286 54 230 54Z" fill="none" stroke="#203655" strokeWidth="10" strokeDasharray="22 18"
          initial={{ pathLength: 0, rotate: -30, transformOrigin: 'center' }} animate={{ pathLength: 1, rotate: 0 }} transition={{ delay: 1.45, duration: 0.65, ease: EASE }} />
      </motion.svg>

      <motion.div style={{ position: 'absolute', left: '8%', top: '43%', width: '76%', fontSize: '4vmin', lineHeight: 1.2, fontWeight: 700, zIndex: 3 }}
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.9, duration: .3, ease: EASE }}>
        Leave a review.<br />Help the next person choose.
      </motion.div>
      <motion.div style={{ position: 'absolute', left: '-8%', right: '-8%', bottom: '-4%', height: '36%', background: '#203655', borderRadius: '9vmin 9vmin 0 0', zIndex: 4 }}
        initial={{ y: '100%', rotate: 2 }} animate={{ y: 0, rotate: 0 }} transition={{ delay: 2.43, duration: .48, ease: EASE }} />
      <motion.img
        src={logo}
        alt="Worky"
        style={{ position: 'absolute', zIndex: 5, bottom: '17%', left: '13%', width: '74%', height: 'auto', objectFit: 'contain' }}
        initial={{ opacity: 0, scale: .78, y: 15 }} animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ delay: 2.62, duration: .45, ease: EASE }}
      />
      <motion.div className="display" style={{ position: 'absolute', zIndex: 5, bottom: '8%', left: '7%', width: '86%', textAlign: 'center', fontSize: '3.5vmin', color: '#f8c859', lineHeight: 1.1 }}
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.99, duration: .3 }}>
        The network that moves your city.
      </motion.div>

      <motion.div aria-hidden="true"
        style={{ position: 'absolute', top: '8%', right: '12%', width: '6vmin', height: '6vmin', border: '.8vmin solid #f58224', borderRadius: '50%', zIndex: 8 }}
        animate={{ scale: [1, .2], x: [0, '-57vmin'], y: [0, '96vmin'], opacity: [1, .65] }}
        transition={{ delay: 4.05, duration: .65, ease: EASE }}
      />
    </motion.section>
  );
}
