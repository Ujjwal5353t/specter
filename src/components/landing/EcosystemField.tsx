'use client';
import { useEffect, useMemo, useRef } from 'react';

/**
 * The landing page's ecosystem visualization: a slowly yawing wireframe globe
 * of npm packages with historically compromised packages marked and linked.
 *
 * Geometry, projection and styling are ported from the design reference
 * (HTML/01 · Entry — Landing-html), but the field sizes itself to whatever box
 * it's given rather than a fixed artboard, so it occupies its own column of the
 * layout at a sensible scale instead of being scaled with the page.
 *
 * Purely decorative — renders no application data. Positions are written
 * imperatively on a 50ms tick so ~560 elements don't go through the reconciler.
 */

// Projection constants from the reference.
const PITCH = 0.32;
const DEPTH = 1150;
const FOCAL = 1020;
const YAW_START = 0.6;
const YAW_STEP = 0.0035;
const TICK_MS = 50;

// Untransformed extent of the globe (frame + breathing room), used to derive a
// fit scale. The host below clips to its own box (so the field never spills
// into the header or hero), so this and MAX_SCALE together must keep the
// sphere's actual on-screen diameter (~564 * scale — the node projection
// radius, independent of the frame/ring constants) inside that box; the caps
// below are chosen so it comfortably is, with margin, from a short laptop
// window up to a tall desktop one.
const NATURAL_SPAN = 630;
const MIN_SCALE = 0.5;
const MAX_SCALE = 1.1;
// The frame's top readouts need this much width to sit side by side.
const MIN_FRAME_W = 470;

type Severity = '' | 'in' | 'high' | 'crit';

interface FieldNode {
  x: number; y: number; z: number;
  r: number;
  sev: Severity;
  label: string;
}

interface FieldEdge {
  a: number;
  b: number;
  kind: '' | 't' | 'h';
}

/** mulberry32 — matches the reference's generator so the layout is identical. */
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

// Real supply-chain compromises, pinned to fixed points on the sphere.
const MARKS: [index: number, sev: Severity, label: string][] = [
  [41, 'crit', 'event-stream'],
  [118, 'crit', 'xz-utils'],
  [23, 'high', 'node-ipc'],
  [88, 'high', 'ua-parser-js'],
  [152, 'high', 'colors'],
  [67, 'high', 'faker'],
  [177, 'high', 'coa'],
  [134, 'high', 'rc'],
];

const THREAT_LINKS: [number, number][] = [
  [41, 23], [41, 88], [41, 67],
  [118, 152], [118, 177], [118, 134],
];

function buildField(): { nodes: FieldNode[]; edges: FieldEdge[] } {
  const R = rng(5);
  const nodes: FieldNode[] = [];
  const edges: FieldEdge[] = [];
  const seen = new Set<string>();
  const shellCount = 200;
  const rad = 318;

  // Fibonacci sphere shell — the visible surface of the ecosystem.
  for (let i = 0; i < shellCount; i++) {
    const y = 1 - (i / (shellCount - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = i * 2.399963;
    const j = 1 + (R() - 0.5) * 0.1;
    nodes.push({
      x: Math.cos(th) * r * rad * j,
      y: y * rad * j,
      z: Math.sin(th) * r * rad * j,
      r: 1.2 + R() * 2.1,
      sev: '',
      label: '',
    });
  }

  // Interior transitive dependencies.
  for (let k = 0; k < 46; k++) {
    const u = R() * 6.283;
    const v = Math.acos(2 * R() - 1);
    const q = rad * (0.25 + R() * 0.45);
    nodes.push({
      x: Math.sin(v) * Math.cos(u) * q,
      y: Math.cos(v) * q,
      z: Math.sin(v) * Math.sin(u) * q,
      r: 1 + R() * 1.4,
      sev: 'in',
      label: '',
    });
  }

  for (const [idx, sev, label] of MARKS) {
    nodes[idx].sev = sev;
    nodes[idx].label = label;
    nodes[idx].r = sev === 'crit' ? 5.5 : 4.2;
  }

  // Link every package to its two nearest neighbours.
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  nodes.forEach((p, i) => {
    const dists: [number, number][] = [];
    nodes.forEach((q, j) => {
      if (i === j) return;
      const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
      dists.push([dx * dx + dy * dy + dz * dz, j]);
    });
    dists.sort((m, n) => m[0] - n[0]);
    for (let m = 0; m < 2; m++) {
      const kk = key(i, dists[m][1]);
      if (!seen.has(kk)) {
        seen.add(kk);
        edges.push({ a: i, b: dists[m][1], kind: '' });
      }
    }
  });

  for (const [a, b] of THREAT_LINKS) edges.push({ a, b, kind: 't' });
  nodes.forEach((p, i) => {
    if (p.sev === 'high') edges.push({ a: i, b: (i * 7 + 11) % shellCount, kind: 'h' });
  });

  return { nodes, edges };
}

function fade(z: number): number {
  return Math.max(0.14, Math.min(1, 1.05 - (z + 320) / 700));
}

export default function EcosystemField() {
  const { nodes, edges } = useMemo(() => buildField(), []);

  const hostRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const ring1Ref = useRef<HTMLDivElement>(null);
  const ring2Ref = useRef<HTMLDivElement>(null);
  const sweepRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const edgeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const yawReadout = useRef<HTMLDivElement>(null);

  const labelled = useMemo(
    () => nodes.map((n, i) => ({ n, i })).filter(({ n }) => n.label !== ''),
    [nodes],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let yaw = YAW_START;
    let last = 0;
    let raf = 0;
    // Box metrics, refreshed by the ResizeObserver.
    let cx = 0, cy = 0, scale = 1;

    const measure = () => {
      const { width, height } = host.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      cx = width / 2;
      cy = height / 2;
      scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(width, height) / NATURAL_SPAN));

      // Frame, glow and rings are all centred on the globe and scale with it.
      const frameW = Math.min(width - 4, Math.max(MIN_FRAME_W, 606 * scale));
      const frameH = Math.min(height - 4, 636 * scale);
      if (frameRef.current) {
        const f = frameRef.current.style;
        f.left = `${(cx - frameW / 2).toFixed(1)}px`;
        f.top = `${(cy - frameH / 2).toFixed(1)}px`;
        f.width = `${frameW.toFixed(1)}px`;
        f.height = `${frameH.toFixed(1)}px`;
      }
      const setBox = (el: HTMLDivElement | null, w: number, h: number) => {
        if (!el) return;
        el.style.left = `${(cx - (w * scale) / 2).toFixed(1)}px`;
        el.style.top = `${(cy - (h * scale) / 2).toFixed(1)}px`;
        el.style.width = `${(w * scale).toFixed(1)}px`;
        el.style.height = `${(h * scale).toFixed(1)}px`;
      };
      setBox(glowRef.current, 840, 760);
      setBox(ring1Ref.current, 760, 190);
      setBox(ring2Ref.current, 660, 330);
      if (sweepRef.current) {
        const w = 560 * scale;
        const s = sweepRef.current.style;
        s.left = `${(cx - w / 2).toFixed(1)}px`;
        s.top = `${cy.toFixed(1)}px`;
        s.width = `${w.toFixed(1)}px`;
        s.setProperty('--ef-sweep-dist', `${(frameH / 2 - 10).toFixed(0)}px`);
      }
    };

    const draw = () => {
      if (cx === 0 && cy === 0) return;
      const cY = Math.cos(yaw), sY = Math.sin(yaw);
      const cP = Math.cos(PITCH), sP = Math.sin(PITCH);

      const px: number[] = new Array(nodes.length);
      const py: number[] = new Array(nodes.length);
      const pz: number[] = new Array(nodes.length);
      const ps: number[] = new Array(nodes.length);
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const x = n.x * cY - n.z * sY;
        const zr = n.x * sY + n.z * cY;
        const y = n.y * cP - zr * sP;
        const z = n.y * sP + zr * cP;
        const s = (FOCAL / (z + DEPTH)) * scale;
        px[i] = cx + x * s;
        py[i] = cy + y * s;
        pz[i] = z;
        ps[i] = s;
      }

      for (let i = 0; i < edges.length; i++) {
        const el = edgeRefs.current[i];
        if (!el) continue;
        const e = edges[i];
        const dx = px[e.b] - px[e.a];
        const dy = py[e.b] - py[e.a];
        el.style.left = `${px[e.a].toFixed(1)}px`;
        el.style.top = `${py[e.a].toFixed(1)}px`;
        el.style.width = `${Math.sqrt(dx * dx + dy * dy).toFixed(1)}px`;
        el.style.transform = `rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(2)}deg)`;
        el.style.opacity = (fade((pz[e.a] + pz[e.b]) / 2) * (e.kind === 't' ? 1.2 : 0.9)).toFixed(2);
      }

      for (let i = 0; i < nodes.length; i++) {
        const el = nodeRefs.current[i];
        if (!el) continue;
        const d = Math.max(1.6, nodes[i].r * 2 * ps[i]);
        el.style.left = `${(px[i] - d / 2).toFixed(1)}px`;
        el.style.top = `${(py[i] - d / 2).toFixed(1)}px`;
        el.style.width = `${d.toFixed(1)}px`;
        el.style.height = `${d.toFixed(1)}px`;
        el.style.opacity = fade(pz[i]).toFixed(2);
        // Nearer packages paint over farther ones without reordering the DOM.
        el.style.zIndex = String(Math.round(1000 - pz[i]));
      }

      for (let k = 0; k < labelled.length; k++) {
        const el = labelRefs.current[k];
        if (!el) continue;
        const { i } = labelled[k];
        // Only label packages on the near face.
        if (pz[i] >= 120) {
          el.style.visibility = 'hidden';
          continue;
        }
        el.style.visibility = 'visible';
        el.style.left = `${(px[i] + 9).toFixed(0)}px`;
        el.style.top = `${(py[i] - 5).toFixed(0)}px`;
        el.style.opacity = fade(pz[i]).toFixed(2);
      }

      if (yawReadout.current) {
        yawReadout.current.textContent = `YAW ${(((yaw * 180) / Math.PI) % 360).toFixed(1)}°`;
      }
    };

    const observer = new ResizeObserver(() => { measure(); draw(); });
    observer.observe(host);
    measure();
    draw();

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < TICK_MS) return;
      last = now;
      // Re-read the box each tick: one rect read at 20Hz is negligible, and it
      // keeps the field correct even where ResizeObserver doesn't fire (e.g.
      // emulated viewport changes, zoom, or a parent resizing without a resize
      // event), instead of leaving the globe sized for a stale box.
      measure();
      if (!reduced) yaw += YAW_STEP;
      draw();
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [nodes, edges, labelled]);

  const readout = {
    position: 'absolute' as const,
    font: "500 10px/1 'JetBrains Mono', ui-monospace, monospace",
    color: '#4F6680',
    whiteSpace: 'nowrap' as const,
  };

  return (
    <div ref={hostRef} className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden>
      <div ref={glowRef} style={{ position: 'absolute', background: 'radial-gradient(closest-side, rgba(30,80,160,.16), rgba(3,6,11,0) 70%)' }} />
      <div ref={ring1Ref} style={{ position: 'absolute', border: '1px solid rgba(79,216,240,.22)', borderRadius: '50%', transform: 'rotate(-11deg)' }} />
      <div ref={ring2Ref} style={{ position: 'absolute', border: '1px dashed rgba(79,216,240,.10)', borderRadius: '50%', transform: 'rotate(18deg)' }} />

      {/* Geometry starts hidden: positions are written on the first tick. */}
      {edges.map((e, i) => (
        <div
          key={`e${i}`}
          ref={(el) => { edgeRefs.current[i] = el; }}
          className={`ef-edge${e.kind === 't' ? ' ef-edge-threat' : e.kind === 'h' ? ' ef-edge-high' : ''}`}
          style={{ left: 0, top: 0, width: 0, opacity: 0 }}
        />
      ))}

      {nodes.map((n, i) => (
        <div
          key={`n${i}`}
          ref={(el) => { nodeRefs.current[i] = el; }}
          className={`ef-node${n.sev ? ` ef-node-${n.sev}` : ''}`}
          style={{ left: 0, top: 0, width: 0, height: 0, opacity: 0 }}
        />
      ))}

      {labelled.map(({ n, i }, k) => (
        <div
          key={`l${i}`}
          ref={(el) => { labelRefs.current[k] = el; }}
          className="ef-label"
          style={{ left: 0, top: 0, visibility: 'hidden', color: n.sev === 'crit' ? '#FF6B78' : '#FFA25C' }}
        >
          {n.sev === 'crit' ? `▲ ${n.label}` : n.label}
        </div>
      ))}

      <div ref={sweepRef} className="ef-sweep" style={{ position: 'absolute', height: 1, background: 'linear-gradient(90deg, rgba(79,216,240,0), rgba(79,216,240,.7), rgba(79,216,240,0))', boxShadow: '0 0 12px rgba(79,216,240,.5)' }} />

      {/* Frame + readouts, sized to the globe */}
      <div ref={frameRef} style={{ position: 'absolute' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, width: 18, height: 18, borderLeft: '1px solid #27405C', borderTop: '1px solid #27405C' }} />
        <div style={{ position: 'absolute', right: 0, top: 0, width: 18, height: 18, borderRight: '1px solid #27405C', borderTop: '1px solid #27405C' }} />
        <div style={{ position: 'absolute', left: 0, bottom: 0, width: 18, height: 18, borderLeft: '1px solid #27405C', borderBottom: '1px solid #27405C' }} />
        <div style={{ position: 'absolute', right: 0, bottom: 0, width: 18, height: 18, borderRight: '1px solid #27405C', borderBottom: '1px solid #27405C' }} />
        <div style={{ ...readout, left: 26, top: 2, letterSpacing: '.14em' }}>ECOSYSTEM FIELD · KNOWN COMPROMISES</div>
        <div ref={yawReadout} style={{ ...readout, right: 26, top: 2, letterSpacing: '.1em' }} />
        <div style={{ ...readout, left: 26, bottom: 2, letterSpacing: '.14em' }}>NODES {nodes.length} · LINKS {edges.length}</div>
      </div>
    </div>
  );
}
