import { motion } from 'framer-motion';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function Scene2() {
  return (
    <motion.section
      className="film"
      style={{ background: '#203655', color: '#f9f6f0' }}
      initial={{ clipPath: 'circle(0% at 28% 65%)' }}
      animate={{ clipPath: 'circle(130% at 28% 65%)' }}
      exit={{ scale: 1.08, rotate: 2, opacity: 0, transition: { duration: 0.32 } }}
      transition={{ duration: 0.5, ease: EASE }}
    >
      <div className="kicker" style={{ position: 'absolute', top: '8%', left: '8%', color: '#f8c859' }}>NEED A HAND?</div>
      <motion.div className="display" style={{ position: 'absolute', top: '13%', left: '7%', width: '90%', fontSize: '10vmin', lineHeight: 0.9, letterSpacing: '-.065em' }}
        initial={{ opacity: 0, y: 35, skewY: 5 }} animate={{ opacity: 1, y: 0, skewY: 0 }} transition={{ delay: 0.12, duration: 0.46, ease: EASE }}>
        FIND YOUR<br /><span style={{ color: '#f58224' }}>FIX.</span>
      </motion.div>

      <motion.div
        style={{ position: 'absolute', left: '-15%', top: '40%', width: '132%', height: '39%', borderRadius: '50%', border: '.45vmin solid rgba(248,200,89,.56)', transform: 'rotate(-19deg)' }}
        initial={{ scale: 0.6, rotate: 0, opacity: 0 }} animate={{ scale: 1, rotate: -19, opacity: 1 }}
        transition={{ delay: 0.24, duration: 0.65, ease: EASE }}
      />
      <motion.div
        style={{ position: 'absolute', left: '13%', top: '41%', width: '5vmin', height: '5vmin', borderRadius: '50%', background: '#f58224', border: '.8vmin solid #f9f6f0', boxShadow: '0 0 0 1.4vmin rgba(245,130,36,.22)' }}
        initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1], x: [0, 10, 0] }} transition={{ delay: 0.56, duration: 0.35, ease: EASE }}
      />
      <motion.div style={{ position: 'absolute', top: '34%', left: '9%', fontSize: '4vmin', fontWeight: 700, color: '#f8c859' }}
        initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.68, duration: 0.25 }}>
        Pros nearby
      </motion.div>

      <motion.div
        className="card-shadow"
        style={{ position: 'absolute', top: '48%', left: '13%', width: '74%', minHeight: '29%', borderRadius: '3.6vmin', background: '#f9f6f0', color: '#203655', padding: '5vmin', transformOrigin: '50% 90%' }}
        initial={{ opacity: 0, y: 100, rotate: 12, scale: 0.72 }}
        animate={{ opacity: 1, y: 0, rotate: -3, scale: 1 }}
        transition={{ delay: 1.42, duration: 0.56, ease: EASE }}
      >
        <div className="mono" style={{ fontSize: '2vmin', color: '#f58224', letterSpacing: '.12em', fontWeight: 700 }}>LOCAL PROFESSIONAL</div>
        <div className="display" style={{ marginTop: '1.8vmin', fontSize: '8vmin', lineHeight: 0.95 }}>PLUMBER</div>
        <motion.div style={{ height: '.35vmin', background: '#d8d2c7', margin: '3vmin 0 2vmin', transformOrigin: 'left' }} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 1.9, duration: 0.4 }} />
        <div style={{ fontSize: '3.2vmin', fontWeight: 700 }}>Services · Reviews</div>
        <motion.div style={{ position: 'absolute', top: '5vmin', right: '5vmin', width: '12vmin', height: '12vmin', borderRadius: '50%', background: '#f8c859', display: 'grid', placeItems: 'center', fontSize: '5.8vmin', color: '#203655' }}
          initial={{ scale: 0, rotate: -50 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 2.1, duration: 0.36, type: 'spring', stiffness: 260, damping: 13 }}>
          <span aria-hidden="true">⌖</span>
        </motion.div>
      </motion.div>
      <motion.div className="display" style={{ position: 'absolute', bottom: '10%', left: '12%', fontSize: '4vmin', color: '#f8c859' }}
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 2.78, duration: 0.28 }}>
        Choose with confidence.
      </motion.div>
      <motion.div aria-hidden="true" style={{ position: 'absolute', right: '3%', top: '54%', width: '14vmin', height: '14vmin', borderRadius: '50%', border: '1vmin solid #f8c859' }}
        initial={{ scale: 0, rotate: -25 }} animate={{ scale: [0, 1.08, 1], rotate: 11 }} transition={{ delay: 3.35, duration: 0.34, ease: EASE }} />
    </motion.section>
  );
}
