'use client';
import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ThreatFlash({ score }: { score: number }) {
  // Lazy initializer computes visibility directly from the prop at mount
  // time — ThreatFlash only ever mounts once per scan (its parent renders
  // it conditionally on `isReady`), so this replaces a setState-in-effect
  // that only ever mirrored the prop into state.
  const [show, setShow] = useState(() => score > 10);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => setShow(false), 800);
    return () => clearTimeout(t);
  }, [show]);

  const color = score > 70
    ? 'rgba(255, 42, 109, 0.12)'
    : score > 40
    ? 'rgba(245, 158, 11, 0.08)'
    : 'rgba(234, 179, 8, 0.06)';

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-20 pointer-events-none"
          style={{ background: color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 0.5, 0] }}
          transition={{ duration: 0.8, times: [0, 0.15, 0.5, 1], ease: "easeOut" }}
        />
      )}
    </AnimatePresence>
  );
}