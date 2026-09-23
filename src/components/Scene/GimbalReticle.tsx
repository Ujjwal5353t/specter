'use client';

/** Bottom-left tactical gimbal/compass — pure HTML+CSS, always-on HUD chrome. */
export default function GimbalReticle() {
  return (
    <div className="absolute bottom-6 left-6 z-30 pointer-events-none select-none" style={{ width: 64, height: 64 }}>
      <svg width="64" height="64" viewBox="0 0 64 64" className="absolute inset-0">
        <circle cx="32" cy="32" r="30" fill="none" stroke="var(--glass-border)" strokeWidth="1" />
        <circle cx="32" cy="32" r="2" fill="var(--accent)" style={{ filter: 'drop-shadow(0 0 4px var(--accent-glow))' }} />
      </svg>
      <svg
        width="64" height="64" viewBox="0 0 64 64"
        className="absolute inset-0 gimbal-ring-outer"
        style={{ transformOrigin: '50% 50%' }}
      >
        <circle cx="32" cy="32" r="26" fill="none" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 6" opacity="0.5" />
      </svg>
      <svg
        width="64" height="64" viewBox="0 0 64 64"
        className="absolute inset-0 gimbal-ring-inner"
        style={{ transformOrigin: '50% 50%' }}
      >
        <path d="M32 10 L32 18 M32 46 L32 54 M10 32 L18 32 M46 32 L54 32" stroke="var(--accent-hi)" strokeWidth="1.2" opacity="0.7" />
        <circle cx="32" cy="32" r="18" fill="none" stroke="var(--accent-hi)" strokeWidth="0.75" opacity="0.35" />
      </svg>
      <div
        className="absolute font-mono uppercase tracking-widest"
        style={{ bottom: -14, left: 0, right: 0, textAlign: 'center', fontSize: 7, color: 'var(--muted)' }}
      >
        GIMBAL
      </div>
    </div>
  );
}
