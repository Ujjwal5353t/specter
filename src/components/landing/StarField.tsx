'use client';
import { useMemo } from 'react';

/**
 * Full-viewport starfield behind the landing page. Positions are seeded and
 * expressed as percentages, so the field covers any viewport without scaling.
 */

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function StarField() {
  const stars = useMemo(() => {
    const R = rng(99);
    return Array.from({ length: 150 }, () => {
      const depth = R();
      return {
        twinkle: R() < 0.25,
        left: R() * 100,
        top: R() * 100,
        size: depth < 0.9 ? 1 : 2,
        opacity: 0.12 + R() * 0.45,
        delay: -(R() * 4),
      };
    });
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {stars.map((s, i) => (
        <div
          key={i}
          className={s.twinkle ? 'ef-star ef-tw' : 'ef-star'}
          style={{
            left: `${s.left}%`,
            top: `${s.top}%`,
            width: s.size,
            height: s.size,
            opacity: s.opacity,
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
