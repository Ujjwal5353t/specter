'use client';
import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Text, Ring } from '@react-three/drei';
import * as THREE from 'three';
import type { DockerFinding } from '@/types';

interface Props { findings: DockerFinding[]; baseImage: string; }

function HolographicPlatform() {
  const sweepRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (sweepRef.current) sweepRef.current.rotation.z = clock.elapsedTime * 0.6;
    if (outerRef.current) outerRef.current.rotation.z = clock.elapsedTime * 0.05;
  });

  return (
    <group position={[0, -135, 0]}>
      {/* Concentric holographic rings — the "platform" */}
      <Ring ref={outerRef} args={[55, 56.5, 64]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color="#00F0FF" transparent opacity={0.35} side={THREE.DoubleSide} />
      </Ring>
      <Ring args={[40, 40.8, 64]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color="#00F0FF" transparent opacity={0.18} side={THREE.DoubleSide} />
      </Ring>
      <Ring args={[25, 25.5, 64]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color="#00F0FF" transparent opacity={0.12} side={THREE.DoubleSide} />
      </Ring>

      {/* Perimeter sweep arc */}
      <Ring ref={sweepRef} args={[55, 56.5, 24, 1, 0, 0.35]} rotation={[-Math.PI / 2, 0, 0]}>
        <meshBasicMaterial color="#4dfaff" transparent opacity={0.8} side={THREE.DoubleSide} />
      </Ring>

      <Text position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} fontSize={3.2} color="#4dfaff" anchorX="center" anchorY="middle" letterSpacing={0.05}>
        [ INFRASTRUCTURE: NO CONTAINER SPEC DETECTED ]
      </Text>
    </group>
  );
}

export default function DockerLayers({ findings, baseImage }: Props) {
  const hasDockerfile = baseImage !== 'No Dockerfile found';

  if (!hasDockerfile) return <HolographicPlatform />;

  const layerCount = Math.max(4, Math.min(findings.length + 3, 9));

  return (
    <group position={[0, -135, 0]}>
      <Text position={[0, layerCount * 7 + 12, 0]} fontSize={4.5} color="#eaf4ff" outlineWidth={0.18} outlineColor="#000000" anchorX="center" letterSpacing={0.03}>
        DOCKER LAYERS
      </Text>
      {Array.from({ length: layerCount }).map((_, i) => {
        const finding = findings.find((f) => f.layer === i || (i === 0 && f.layer === 0));
        const isVuln = !!finding;
        const isCritical = finding?.severity === 'critical';
        const width = 140 - i * 10;
        const color = isCritical ? '#3a0a1a' : isVuln ? '#2d1c00' : '#0a1830';
        const emissive = isCritical ? '#FF2A6D' : isVuln ? '#F59E0B' : '#00F0FF';

        return (
          <group key={i} position={[0, i * 7.5, 0]}>
            <Box args={[width, 5, 35]}>
              <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={isVuln ? 0.55 : 0.1} transparent opacity={0.92} side={THREE.DoubleSide} />
            </Box>
            <Box args={[width + 0.3, 5.3, 35.3]}>
              <meshBasicMaterial color={emissive} wireframe transparent opacity={isVuln ? 0.35 : 0.12} />
            </Box>
            <Text
              position={[0, 0, 18.5]}
              fontSize={3.2}
              color="#eaf4ff"
              outlineWidth={0.15}
              outlineColor="#000000"
              anchorX="center"
              anchorY="middle"
            >
              {i === 0 ? baseImage.substring(0, 20) : `layer ${i}${isVuln ? ' ⚠' : ''}`}
            </Text>
          </group>
        );
      })}
    </group>
  );
}
