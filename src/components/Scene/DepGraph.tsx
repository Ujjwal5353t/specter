'use client';
import { useRef, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Line, Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import type { DepNode, DepEdge } from '@/types';
import { useScanStore } from '@/store/scanStore';
import { computeNodePositions, nodeVisual } from '@/lib/depGraphLayout';

interface Props { nodes: DepNode[]; edges: DepEdge[]; filter?: 'all' | 'vulnerable'; }

function DepSphere({
  node,
  pos,
  hovered,
  onHover,
}: {
  node: DepNode;
  pos: [number, number, number];
  hovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { setSelectedNode, selectedNode } = useScanStore();
  const visual = nodeVisual(node);
  const isSelected = selectedNode === node.id;
  const showLabel = hovered || isSelected || visual.pulse;

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (visual.pulse) {
      const s = 1 + 0.12 * Math.sin(clock.elapsedTime * 3.2);
      meshRef.current.scale.setScalar(s);
    } else if (hovered) {
      meshRef.current.scale.setScalar(1.25);
    } else {
      meshRef.current.scale.setScalar(1);
    }
  });

  return (
    <group position={pos}>
      <Sphere
        ref={meshRef}
        args={[visual.radius, 24, 24]}
        onPointerOver={(e) => { e.stopPropagation(); onHover(node.id); document.body.style.cursor = 'pointer'; }}
        onPointerOut={(e) => { e.stopPropagation(); onHover(null); document.body.style.cursor = 'auto'; }}
        onClick={(e) => { e.stopPropagation(); setSelectedNode(node.id); }}
      >
        <meshStandardMaterial
          color={visual.color}
          emissive={visual.color}
          emissiveIntensity={visual.emissiveIntensity}
          roughness={0.25}
          metalness={0.4}
        />
      </Sphere>

      {visual.pulse && <pointLight color={visual.color} intensity={2.2} distance={22} />}

      {(node.cves?.length ?? 0) > 0 && (
        <Sphere args={[visual.radius + 2.5, 12, 12]}>
          <meshBasicMaterial color={visual.color} transparent opacity={0.1} wireframe />
        </Sphere>
      )}

      {showLabel && (
        <Billboard follow lockX={false} lockY={false} lockZ={false}>
          <Text
            position={[0, visual.radius + 3.5, 0]}
            fontSize={2.8}
            color="#eaf4ff"
            outlineWidth={0.18}
            outlineColor="#000000"
            anchorX="center"
            maxWidth={36}
          >
            {`${node.name}@${node.version}`}
          </Text>
        </Billboard>
      )}
    </group>
  );
}

export default function DepGraph({ nodes, edges, filter = 'all' }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const positions = useMemo(() => computeNodePositions(nodes), [nodes]);

  const visibleNodes = useMemo(
    () => nodes.filter((n) => !n.isRoot && (filter === 'all' || (n.cves?.length ?? 0) > 0)),
    [nodes, filter]
  );
  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);

  useFrame(() => {
    if (groupRef.current && !useScanStore.getState().selectedNode) {
      groupRef.current.rotation.y += 0.0006;
    }
  });

  return (
    <group ref={groupRef}>
      {edges.map((edge, i) => {
        if (!visibleIds.has(edge.to)) return null;
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return null;
        const toNode = nodes.find((n) => n.id === edge.to);
        const isAttack = (toNode?.cves?.length ?? 0) > 0;
        return (
          <Line
            key={`e-${i}`}
            points={[from, to]}
            color={isAttack ? '#FF2A6D' : '#00F0FF'}
            lineWidth={isAttack ? 2.5 : 1}
            transparent
            opacity={isAttack ? 0.85 : 0.22}
          />
        );
      })}

      {visibleNodes.map((node) => {
        const pos = positions.get(node.id);
        if (!pos) return null;
        return (
          <DepSphere
            key={node.id}
            node={node}
            pos={pos}
            hovered={hoveredId === node.id}
            onHover={setHoveredId}
          />
        );
      })}
    </group>
  );
}
