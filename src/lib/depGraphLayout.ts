import type { DepNode, Severity } from '@/types';

/**
 * Colours of the 3D scene, shared with the on-screen legend so the two can't
 * drift. Vulnerability tiers match the sidebar's severity tags.
 */
export const SCENE_COLORS = {
  critical: '#FF2A6D',
  high: '#FF7A1A',
  medium: '#eab308',
  low: '#8fa8cc',
  riskSignal: '#a78bfa',
  direct: '#00F0FF',
  transitive: '#0e6fa8',
  authed: '#22c55e',
  unauthed: '#F59E0B',
} as const;

/**
 * Deterministic [0,1) value derived from a string id (FNV-1a hash).
 * Replaces Math.random() so node jitter is stable across renders/StrictMode
 * double-invocation, and identical for every consumer of this module —
 * this is what keeps DepGraph's spheres and AttackPaths' particle streams
 * pointed at the exact same coordinates.
 */
function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

export type NodePosition = [number, number, number];

/**
 * Single source of truth for where every dependency node sits in 3D space.
 * DepGraph, AttackPaths, and anything else that needs node coordinates
 * must import this instead of recomputing positions locally.
 */
export function computeNodePositions(nodes: DepNode[]): Map<string, NodePosition> {
  const map = new Map<string, NodePosition>();
  const directNodes = nodes.filter((n) => n.isDirect && !n.isRoot);
  const transitiveNodes = nodes.filter((n) => !n.isDirect && !n.isRoot);

  nodes.forEach((node) => {
    if (node.isRoot) map.set(node.id, [0, 0, 0]);
  });

  directNodes.forEach((node, i) => {
    const angle = (i / Math.max(directNodes.length, 1)) * Math.PI * 2;
    const r = 65 + (i % 3) * 12;
    const jitter = (hash01(node.id) - 0.5) * 35;
    map.set(node.id, [Math.cos(angle) * r, jitter, Math.sin(angle) * r]);
  });

  transitiveNodes.forEach((node, i) => {
    const angle = (i / Math.max(transitiveNodes.length, 1)) * Math.PI * 2 + 0.3;
    const r = 115 + (i % 4) * 15;
    const jitter = (hash01(node.id) - 0.5) * 50;
    map.set(node.id, [Math.cos(angle) * r, jitter, Math.sin(angle) * r]);
  });

  return map;
}

export interface NodeVisual {
  radius: number;
  color: string;
  emissiveIntensity: number;
  pulse: boolean;
}

/** True when a node carries a supply-chain risk signal worth surfacing (medium or worse). */
export function hasRiskSignal(node: DepNode): boolean {
  return node.signals?.some((s) => s.severity !== 'low' && s.severity !== 'info') ?? false;
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

/** The most severe advisory on a node, or null if it has none. */
export function worstCveSeverity(node: DepNode): Severity | null {
  let worst: Severity | null = null;
  for (const c of node.cves ?? []) {
    if (!worst || SEVERITY_RANK[c.severity] > SEVERITY_RANK[worst]) worst = c.severity;
  }
  return worst;
}

/** Severity-driven sizing/coloring: a vulnerable node takes its worst advisory's tier. */
export function nodeVisual(node: DepNode): NodeVisual {
  const worst = worstCveSeverity(node);

  if (worst === 'critical') return { radius: 5.5, color: SCENE_COLORS.critical, emissiveIntensity: 1.1, pulse: true };
  if (worst === 'high') return { radius: 4.8, color: SCENE_COLORS.high, emissiveIntensity: 0.8, pulse: false };
  if (worst === 'medium') return { radius: 4, color: SCENE_COLORS.medium, emissiveIntensity: 0.7, pulse: false };
  if (worst) return { radius: 3.2, color: SCENE_COLORS.low, emissiveIntensity: 0.5, pulse: false };
  if (hasRiskSignal(node)) return { radius: 3.5, color: SCENE_COLORS.riskSignal, emissiveIntensity: 0.6, pulse: false };
  return {
    radius: node.isDirect ? 2.6 : 1.8,
    color: node.isDirect ? SCENE_COLORS.direct : SCENE_COLORS.transitive,
    emissiveIntensity: node.isDirect ? 0.45 : 0.2,
    pulse: false,
  };
}
