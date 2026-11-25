import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function Scene3() {
  return (
    <motion.section
      className="film"
      style={{ background: '#f8c859', color: '#203655' }}
      initial={{ clipPath: 'inset(0 0 100% 0)' }}
      animate={{ clipPath: 'inset(0 0 0% 0)' }}
      exit={{ clipPath: 'polygon(0 0,100% 8%,100% 100%,0 88%)', x: '4%', opacity: 0, transition: { duration: 0.34 } }}
      transition={{ duration: 0.46, ease: EASE }}
    >
      <motion.div style={{ position: 'absolute', top: '-13%', right: '-19%', width: '78vmin', height: '78vmin', borderRadius: '50%', border: '4vmin solid #f9f6f0', background: '#f58224' }}
        initial={{ scale: 0.3, rotate: -45 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.08, duration: 0.55, ease: EASE }} />
      <motion.div className="display outline" style={{ '--outline-color': '#203655', position: 'absolute', left: '7%', top: '12%', zIndex: 2, fontSize: '9vmin', lineHeight: 0.9, letterSpacing: '-.06em' } as CSSProperties}
        initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, duration: 0.38, ease: EASE }}>
        REAL<br />PEOPLE.
      </motion.div>
      <motion.div className="display" style={{ position: 'absolute', left: '7%', top: '32%', zIndex: 2, fontSize: '8vmin', lineHeight: 0.9, letterSpacing: '-.06em' }}
        initial={{ opacity: 0, scaleX: 0.55, transformOrigin: 'left' }} animate={{ opacity: 1, scaleX: 1 }} transition={{ delay: 1.38, duration: 0.35, ease: EASE }}>
        Clear plans.
      </motion.div>

      <motion.div
        style={{ position: 'absolute', left: '8%', top: '48%', width: '84%', minHeight: '30%', borderRadius: '3vmin', background: '#203655', color: '#f9f6f0', padding: '3.5vmin', zIndex: 3, border: '.7vmin solid #f9f6f0' }}
        initial={{ opacity: 0, rotateX: -28, y: 50, scale: 0.9 }} animate={{ opacity: 1, rotateX: 0, y: 0, scale: 1 }} transition={{ delay: 1.83, duration: 0.45, ease: EASE }}
      >
        <motion.div style={{ display: 'inline-flex', alignItems: 'center', gap: '1.4vmin', color: '#f8c859', fontSize: '3.3vmin', fontWeight: 800 }}
          initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.66, duration: 0.3 }}>
          <span style={{ width: '4.5vmin', height: '4.5vmin', display: 'grid', placeItems: 'center', borderRadius: '50%', background: '#f8c859', color: '#203655', fontSize: '3vmin' }}>✓</span>
          Profile reviewed
        </motion.div>
        <motion.div style={{ marginTop: '2.6vmin', width: '86%', padding: '2.5vmin 3vmin', borderRadius: '2.4vmin 2.4vmin 2.4vmin .5vmin', background: '#f9f6f0', color: '#203655', fontSize: '3.3vmin', fontWeight: 700 }}
          initial={{ opacity: 0, x: -24, scale: 0.92 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: 2.03, duration: 0.3, ease: EASE }}>
          Can you come by?
        </motion.div>
        <motion.div style={{ marginTop: '1.4vmin', marginLeft: 'auto', width: '88%', padding: '2.4vmin 2.8vmin', borderRadius: '2.4vmin 2.4vmin .5vmin 2.4vmin', background: '#f58224', color: '#203655', fontSize: '3.15vmin', fontWeight: 800 }}
          initial={{ opacity: 0, x: 30, scale: 0.92 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ delay: 2.44, duration: 0.32, ease: EASE }}>
          Let’s arrange a visit.
        </motion.div>
      </motion.div>
      <motion.div className="kicker" style={{ position: 'absolute', bottom: '10%', left: '9%', zIndex: 4, color: '#203655' }}
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 3.49, duration: 0.25 }}>
        Coordinate in the app.
      </motion.div>
      <motion.svg viewBox="0 0 450 280" style={{ position: 'absolute', bottom: '-5%', right: '-2%', width: '55%', height: '31%', zIndex: 1, overflow: 'visible' }} aria-hidden="true">
        <motion.path d="M20 230 C130 30 220 270 430 45" fill="none" stroke="#f58224" strokeWidth="16" strokeLinecap="round" strokeDasharray="1 25"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ delay: 3.0, duration: 0.7, ease: EASE }} />
        <motion.circle cx="430" cy="45" r="25" fill="#203655" initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }} transition={{ delay: 3.63, duration: 0.25, ease: EASE }} />
      </motion.svg>
    </motion.section>
  );
}
