import { motion } from 'framer-motion';

const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function Scene1() {
  return (
    <motion.section
      className="film paper-grain"
      style={{ background: '#f9f6f0', color: '#203655' }}
      initial={{ clipPath: 'circle(120% at 53% 43%)' }}
      animate={{ clipPath: 'circle(120% at 53% 43%)' }}
      exit={{ clipPath: 'circle(0% at 53% 43%)', transition: { duration: 0.34 } }}
    >
      <motion.div
        style={{ position: 'absolute', top: '7%', left: '8%', fontSize: '31vmin', lineHeight: 0.78, letterSpacing: '-.1em', zIndex: 3 }}
        initial={{ scale: 0.2, rotate: -8, opacity: 0 }}
        animate={{ scale: [0.2, 1.08, 1], rotate: [-8, 2, 0], opacity: [0, 1, 1] }}
        transition={{ delay: 0.12, duration: 0.42, times: [0, 0.72, 1], ease: EASE }}
      >
        <span className="display">OH NO.</span>
      </motion.div>
      <motion.div
        className="display"
        style={{ position: 'absolute', top: '23%', right: '5%', zIndex: 5, color: '#f58224', fontSize: '34vmin', lineHeight: 0.83, letterSpacing: '-.09em' }}
        initial={{ scale: 0.25, rotate: 8, opacity: 0 }}
        animate={{ scale: [0.25, 1.12, 1], rotate: [8, -2, 0], opacity: [0, 1, 1] }}
        transition={{ delay: 1.13, duration: 0.36, times: [0, 0.66, 1], ease: EASE }}
      >
        LEAK!
      </motion.div>

      <motion.div
        style={{ position: 'absolute', left: '9%', top: '43%', zIndex: 4, fontSize: '8vmin', fontWeight: 800, lineHeight: 1 }}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.9, duration: 0.26, ease: EASE }}
      >
        Pipe burst?
      </motion.div>
      <motion.div
        className="kicker"
        style={{ position: 'absolute', left: '10%', top: '52%', zIndex: 4, color: '#51647d' }}
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 2.5, duration: 0.24 }}
      >
        Don’t panic.
      </motion.div>

      <svg viewBox="0 0 700 570" style={{ position: 'absolute', width: '98%', height: '59%', left: '1%', bottom: '-3%', overflow: 'visible' }} aria-hidden="true">
        <motion.path
          d="M110 520V300Q110 205 210 205H384Q480 205 480 300V386"
          fill="none" stroke="#203655" strokeWidth="78" strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ delay: 0.03, duration: 0.7, ease: EASE }}
        />
        <motion.path
          d="M481 392 C465 425 434 460 460 492 C485 522 530 501 528 468 C527 447 500 419 481 392Z"
          fill="#f58224"
          initial={{ scale: 0, rotate: -25, transformOrigin: '50% 50%' }}
          animate={{ scale: [0, 1.1, 1], rotate: [-25, 8, 0] }}
          transition={{ delay: 0.89, duration: 0.42, ease: EASE }}
        />
        <motion.circle cx="199" cy="205" r="63" fill="#f8c859" stroke="#f9f6f0" strokeWidth="12"
          initial={{ scale: 0, transformOrigin: 'center' }} animate={{ scale: [0, 1.15, 1] }} transition={{ delay: 0.42, duration: 0.35, ease: EASE }} />
        <motion.circle cx="598" cy="348" r="20" fill="#f8c859"
          initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1], y: [0, -48, 0] }} transition={{ delay: 0.74, duration: 0.5, ease: EASE }} />
        <motion.circle cx="565" cy="436" r="12" fill="#f58224"
          initial={{ scale: 0 }} animate={{ scale: [0, 1.2, 1], y: [0, -32, 0] }} transition={{ delay: 1.0, duration: 0.46, ease: EASE }} />
      </svg>
      <motion.div
        aria-hidden="true"
        style={{ position: 'absolute', width: '9vmin', height: '9vmin', borderRadius: '50%', border: '.85vmin solid #f8c859', right: '13%', bottom: '12%' }}
        animate={{ scale: [1, 1.38, 1], opacity: [0.7, 0.2, 0.7] }}
        transition={{ delay: 1.8, duration: 1.05, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.section>
  );
}
