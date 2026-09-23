import type { DepNode } from '@/types';

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

/** Severity-driven sizing/coloring, shared by DepGraph and AttackPaths. */
export function nodeVisual(node: DepNode): NodeVisual {
  const isCritical = node.cves?.some((c) => c.severity === 'critical') ?? false;
  const isVuln = (node.cves?.length ?? 0) > 0;

  if (isCritical) return { radius: 5.5, color: '#FF2A6D', emissiveIntensity: 1.1, pulse: true };
  if (isVuln) return { radius: 4, color: '#F59E0B', emissiveIntensity: 0.7, pulse: false };
  return {
    radius: node.isDirect ? 2.6 : 1.8,
    color: node.isDirect ? '#00F0FF' : '#0e6fa8',
    emissiveIntensity: node.isDirect ? 0.45 : 0.2,
    pulse: false,
  };
}
