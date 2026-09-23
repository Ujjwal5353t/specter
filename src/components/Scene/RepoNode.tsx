'use client';
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere, Text, Ring } from '@react-three/drei';
import * as THREE from 'three';
import { useScanStore } from '@/store/scanStore';

// Deterministic pseudo-random in [0,1) — a mulberry32-style PRNG seeded by
// index, so dust positions are stable across renders/StrictMode
// double-invocation instead of calling Math.random() during render.
function seeded(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function makeShell(count: number, rMin: number, rMax: number, flatten: number, seedOffset: number) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const s = i + seedOffset;
    const r = rMin + seeded(s * 3) * (rMax - rMin);
    const theta = seeded(s * 3 + 1) * Math.PI * 2;
    const phi = Math.acos(2 * seeded(s * 3 + 2) - 1);
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * flatten;
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

/** Two parallax dust shells — near (faster, brighter) and far (slower, dimmer) — for cosmic depth. */
function DustField({ color }: { color: string }) {
  const nearRef = useRef<THREE.Points>(null);
  const farRef = useRef<THREE.Points>(null);
  const nearMatRef = useRef<THREE.PointsMaterial>(null);
  const farMatRef = useRef<THREE.PointsMaterial>(null);

  const nearGeo = useMemo(() => makeShell(140, 22, 34, 0.4, 0), []);
  const farGeo = useMemo(() => makeShell(90, 40, 58, 0.5, 1000), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (nearRef.current) nearRef.current.rotation.y = t * 0.022;
    if (farRef.current) farRef.current.rotation.y = -t * 0.008;
    // Gentle twinkle — restrained, not blinking.
    if (nearMatRef.current) nearMatRef.current.opacity = 0.45 + Math.sin(t * 0.6) * 0.08;
    if (farMatRef.current) farMatRef.current.opacity = 0.18 + Math.sin(t * 0.4 + 1.4) * 0.05;
  });

  return (
    <>
      <points ref={nearRef} geometry={nearGeo}>
        <pointsMaterial ref={nearMatRef} color={color} size={0.32} transparent opacity={0.45} sizeAttenuation />
      </points>
      <points ref={farRef} geometry={farGeo}>
        <pointsMaterial ref={farMatRef} color={color} size={0.22} transparent opacity={0.18} sizeAttenuation />
      </points>
    </>
  );
}

export default function RepoNode() {
  const meshRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const ring3Ref = useRef<THREE.Mesh>(null);
  const laserRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const { scanResult } = useScanStore();
  const isReady = !!scanResult;
  const score = scanResult?.threatScore ?? 0;

  const color = !isReady ? '#00F0FF' : score > 70 ? '#FF2A6D' : score > 40 ? '#F59E0B' : '#00F0FF';
  const repoName = scanResult?.repoUrl?.split('/').slice(-2).join('/') ?? '';

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.003;
      meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.05;
      const pulse = 1 + 0.045 * Math.sin(state.clock.elapsedTime * 1.6);
      meshRef.current.scale.setScalar(pulse);
    }
    if (glowRef.current) {
      const breathe = 1 + 0.06 * Math.sin(state.clock.elapsedTime * 1.6);
      glowRef.current.scale.setScalar(breathe);
    }
    if (ringRef.current) ringRef.current.rotation.z += 0.006;
    if (ring2Ref.current) ring2Ref.current.rotation.x = 0.4 + Math.sin(state.clock.elapsedTime * 0.3) * 0.1;
    if (ring2Ref.current) ring2Ref.current.rotation.z -= 0.004;
    if (ring3Ref.current) ring3Ref.current.rotation.y += 0.008;
    if (laserRef.current) laserRef.current.rotation.y = state.clock.elapsedTime * 0.7;
  });

  return (
    <group>
      {/* Atmospheric halo — soft, layered falloff for depth */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[13, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[19, 32, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.025} depthWrite={false} />
      </mesh>

      {/* Core sphere — breathing cyber-orb */}
      <Sphere ref={meshRef} args={[10, 64, 64]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.7} roughness={0.15} metalness={0.9} />
      </Sphere>

      <Sphere args={[15, 32, 32]}>
        <meshStandardMaterial color={color} transparent opacity={0.06} wireframe />
      </Sphere>

      {/* Orbital rings */}
      <Ring ref={ringRef} args={[17, 19, 64]}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} transparent opacity={0.5} side={THREE.DoubleSide} />
      </Ring>
      <Ring ref={ring2Ref} args={[22, 22.6, 64]} rotation={[0.4, 0, 0]}>
        <meshBasicMaterial color={color} transparent opacity={0.25} side={THREE.DoubleSide} />
      </Ring>
      <Ring ref={ring3Ref} args={[26.5, 26.9, 48]} rotation={[1.2, 0.3, 0]}>
        <meshBasicMaterial color={color} transparent opacity={0.15} side={THREE.DoubleSide} />
      </Ring>

      {/* Scanning laser sweep — subtle, slow */}
      <mesh ref={laserRef}>
        <planeGeometry args={[0.12, 36]} />
        <meshBasicMaterial color={color} transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>

      <DustField color={color} />

      {isReady && (
        <>
          <Text
            position={[0, -22, 0]}
            fontSize={4.5}
            color="#eaf4ff"
            outlineWidth={0.25}
            outlineColor="#000000"
            anchorX="center"
            anchorY="middle"
          >
            {repoName}
          </Text>
          <Text
            position={[0, -28, 0]}
            fontSize={3.5}
            color="#eaf4ff"
            outlineWidth={0.2}
            outlineColor="#000000"
            anchorX="center"
            anchorY="middle"
          >
            {`THREAT SCORE: ${score}/100`}
          </Text>
        </>
      )}
    </group>
  );
}
