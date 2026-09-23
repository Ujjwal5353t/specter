'use client';
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { DepNode } from '@/types';
import { computeNodePositions } from '@/lib/depGraphLayout';

interface Props { nodes: DepNode[]; }

export default function AttackPaths({ nodes }: Props) {
  const pointsRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);

  const vulnNodes = useMemo(
    () => nodes.filter((n) => !n.isRoot && (n.cves?.length ?? 0) > 0),
    [nodes]
  );

  // Same positions DepGraph renders its spheres at — this is what makes the
  // particle streams actually converge on the vulnerable node instead of
  // flowing along a flat plane that misses it.
  const positions = useMemo(() => computeNodePositions(nodes), [nodes]);

  const PARTICLES_PER_NODE = 25;

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const count = Math.max(vulnNodes.length, 1) * PARTICLES_PER_NODE;
    const pos = new Float32Array(count * 3);
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return geom;
  }, [vulnNodes.length]);

  useFrame(() => {
    timeRef.current += 0.018;
    if (!pointsRef.current || vulnNodes.length === 0) return;
    const attr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = attr.array as Float32Array;
    const root = new THREE.Vector3(0, 0, 0);

    vulnNodes.forEach((node, ni) => {
      const p3 = positions.get(node.id);
      if (!p3) return;
      const nodePos = new THREE.Vector3(p3[0], p3[1], p3[2]);
      for (let p = 0; p < PARTICLES_PER_NODE; p++) {
        const t = ((timeRef.current * 0.6 + ni * 0.4 + p * (1 / PARTICLES_PER_NODE)) % 1);
        const idx = (ni * PARTICLES_PER_NODE + p) * 3;
        arr[idx]     = nodePos.x + (root.x - nodePos.x) * t;
        arr[idx + 1] = nodePos.y + (root.y - nodePos.y) * t + Math.sin(t * Math.PI) * 6;
        arr[idx + 2] = nodePos.z + (root.z - nodePos.z) * t;
      }
    });
    attr.needsUpdate = true;
  });

  if (vulnNodes.length === 0) return null;

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial
        color="#FF2A6D"
        size={2}
        transparent
        opacity={0.9}
        sizeAttenuation
      />
    </points>
  );
}
