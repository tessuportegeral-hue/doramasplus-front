import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const SESSION_KEY = 'dp_splash_shown';
const HOLD_MS = 1000;
const WORD = 'DoramasPlus';
const TEXT_START = 0.28;
const LETTER_STEP = 0.02;

export default function SplashScreen() {
  const [visible, setVisible] = useState(() => {
    try {
      return !sessionStorage.getItem(SESSION_KEY);
    } catch {
      return true;
    }
  });

  useEffect(() => {
    if (!visible) return;
    try {
      sessionStorage.setItem(SESSION_KEY, '1');
    } catch {}
    const timer = setTimeout(() => setVisible(false), HOLD_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35, ease: 'easeInOut' }}
        >
          <div className="flex flex-col items-center">
            <motion.img
              src="/logo-d-mark.png"
              alt="DoramasPlus"
              className="w-20 h-20 object-contain"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
            />

            <span className="mt-4 text-xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-blue-400 bg-clip-text text-transparent">
              {WORD.split('').map((letter, i) => (
                <motion.span
                  key={i}
                  className="inline-block"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: TEXT_START + i * LETTER_STEP,
                    duration: 0.15,
                    ease: 'easeOut',
                  }}
                >
                  {letter}
                </motion.span>
              ))}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
