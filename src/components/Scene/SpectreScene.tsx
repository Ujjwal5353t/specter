'use client';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Suspense, useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useScanStore } from '@/store/scanStore';
import RepoNode from './RepoNode';
import DepGraph from './DepGraph';
import CommitTimeline from './CommitTimeline';
import DockerLayers from './DockerLayers';
import ApiSpokes from './ApiSpokes';
import AttackPaths from './AttackPaths';
import GroundGrid from './GroundGrid';
import HUDControls, { type LayerFilter, type LayoutMode } from './HUDControls';
import GimbalReticle from './GimbalReticle';
import SceneLegend from './SceneLegend';

// How long the map must sit untouched before the camera glides back to the default view.
const IDLE_RETURN_MS = 12_000;

// ── CINEMATIC CAMERA ANIMATOR ──
function SceneAnimator({
  isReady,
  controlsRef,
  layoutMode,
  focusCount,
}: {
  isReady: boolean;
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
  layoutMode: LayoutMode;
  focusCount: number;
}) {
  const vecPos = new THREE.Vector3();
  const vecLook = new THREE.Vector3();
  const lastFocusCount = useRef(0);
  // The camera only glides while settling into a new view (scan loaded,
  // 2D/3D toggle, or returning after the map sat idle). Once it arrives — or
  // the user grabs the map — it stops steering, so orbiting, panning and
  // zooming stay where the user left them.
  const settling = useRef(true);
  const lastView = useRef('');
  // Idle return: the user moved the camera away, and when they last did anything.
  const displaced = useRef(false);
  const interacting = useRef(false);
  const lastActivity = useRef(0);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onStart = () => {
      settling.current = false;
      displaced.current = true;
      interacting.current = true;
    };
    const onEnd = () => {
      interacting.current = false;
      lastActivity.current = performance.now();
    };
    // Hovering nodes to read labels counts as activity too.
    const onPointerMove = () => { lastActivity.current = performance.now(); };
    controls.addEventListener('start', onStart);
    controls.addEventListener('end', onEnd);
    gl.domElement.addEventListener('pointermove', onPointerMove);
    return () => {
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('end', onEnd);
      gl.domElement.removeEventListener('pointermove', onPointerMove);
    };
  }, [controlsRef, gl]);

  useFrame((state, delta) => {
    if (!controlsRef.current) return;

    const view = `${isReady}|${layoutMode}`;
    if (view !== lastView.current) {
      lastView.current = view;
      settling.current = true;
    }
    const focused = focusCount !== lastFocusCount.current;

    // Glide home once the map has sat untouched, unless a node is selected
    // (the user is likely reading its details).
    if (
      isReady && displaced.current && !settling.current && !interacting.current &&
      !useScanStore.getState().selectedNode &&
      performance.now() - lastActivity.current > IDLE_RETURN_MS
    ) {
      settling.current = true;
    }

    if (!settling.current && !focused) return;

    // CRITICAL FIX: Prevent the camera from "snapping" if React drops
    // frames while mounting the heavy 3D data. Max delta = 50ms.
    const safeDelta = Math.min(delta, 0.05);

    if (layoutMode === '2d') {
      vecPos.set(0, 340, 0.01);
      vecLook.set(0, 0, 0);
    } else if (!isReady) {
      vecPos.set(0, 10, 160);
      vecLook.set(0, -45, 0);
    } else {
      vecPos.set(0, 60, 270);
      vecLook.set(0, -30, 0);
    }

    // "Focus Core" snaps immediately instead of easing, so it reads as a
    // deliberate reset rather than just another lerp tick. Comparing the
    // prop against a ref here is safe because useFrame runs outside React's
    // render phase — unlike mutating a ref directly in the component body.
    if (focused) {
      lastFocusCount.current = focusCount;
      settling.current = false;
      displaced.current = false;
      state.camera.position.copy(vecPos);
      controlsRef.current.target.copy(vecLook);
    } else {
      state.camera.position.lerp(vecPos, safeDelta * 4);
      controlsRef.current.target.lerp(vecLook, safeDelta * 4);
      // Close enough: hand the camera back to the user.
      if (state.camera.position.distanceTo(vecPos) < 0.5 && controlsRef.current.target.distanceTo(vecLook) < 0.5) {
        settling.current = false;
        displaced.current = false;
      }
    }
    controlsRef.current.update();
  });

  return null;
}

// ── DYNAMIC THREAT LIGHT ──
function DynamicThreatLight({ score }: { score: number }) {
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (lightRef.current && score > 70) {
      const pulse = Math.sin(clock.elapsedTime * 5) * 0.5 + 0.5;
      lightRef.current.intensity = 1.0 + pulse * 2.0;
    }
  });

  if (score <= 40) return null;
  const color = score > 70 ? '#FF2A6D' : '#F59E0B';

  return <pointLight ref={lightRef} position={[90, 30, 90]} intensity={2.0} color={color} distance={250} />;
}

export default function SpectreScene() {
  const { scanResult } = useScanStore();
  const isReady = !!scanResult;
  const score = scanResult?.threatScore ?? 0;
  const controlsRef = useRef<OrbitControlsImpl>(null);

  const [filter, setFilter] = useState<LayerFilter>('all');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('3d');
  const [focusCount, setFocusCount] = useState(0);

  const handleFocusCore = useCallback(() => setFocusCount((c) => c + 1), []);

  // Esc clears a node picked in the map.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useScanStore.getState().setSelectedNode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showDeps = filter === 'all' || filter === 'vulnerable';
  const showApis = filter === 'all' || filter === 'api';
  const showCommits = filter === 'all' || filter === 'commits';
  const showDocker = filter === 'all';

  return (
    <div className="relative w-full h-screen">
      <Canvas
        camera={{ position: [0, 10, 160], fov: 52 }}
        style={{ background: 'transparent', width: '100%', height: '100vh' }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        // A click on empty space (not a drag) clears the node selection.
        onPointerMissed={() => useScanStore.getState().setSelectedNode(null)}
      >
        <SceneAnimator isReady={isReady} controlsRef={controlsRef} layoutMode={layoutMode} focusCount={focusCount} />

        <ambientLight intensity={0.05} color="#061a2e" />
        <pointLight position={[0, 0, 0]} intensity={2.8} color="#0a3a52" distance={280} />
        <pointLight position={[0, 180, 60]} intensity={0.6} color="#081a40" />
        <pointLight position={[0, -80, -200]} intensity={0.3} color="#00F0FF" />
        <DynamicThreatLight score={score} />

        <Stars radius={400} depth={60} count={3000} factor={6} saturation={0} fade speed={3} />
        {isReady && <GroundGrid />}

        <Suspense fallback={null}>
          <RepoNode />
          {scanResult?.depchain && showDeps && (
            <DepGraph nodes={scanResult.depchain.nodes} edges={scanResult.depchain.edges} filter={filter === 'vulnerable' ? 'vulnerable' : 'all'} />
          )}
          {scanResult?.ghostcommit && showCommits && (
            <CommitTimeline findings={scanResult.ghostcommit.findings} />
          )}
          {scanResult?.layerscan && showDocker && (
            <DockerLayers findings={scanResult.layerscan.findings} baseImage={scanResult.layerscan.baseImage} />
          )}
          {scanResult?.apibleed && showApis && (
            <ApiSpokes endpoints={scanResult.apibleed.endpoints} />
          )}
          {scanResult?.depchain && showDeps && (
            <AttackPaths nodes={scanResult.depchain.nodes} />
          )}
        </Suspense>

        <EffectComposer multisampling={4}>
          <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={1.0} />
        </EffectComposer>

        <OrbitControls
          ref={controlsRef}
          enablePan={true}
          enableZoom={true}
          autoRotate={!isReady && layoutMode === '3d'}
          autoRotateSpeed={0.5}
          maxDistance={700}
          minDistance={20}
          dampingFactor={0.05}
          enableDamping
        />
      </Canvas>

      <GimbalReticle />
      {isReady && <SceneLegend />}
      {isReady && (
        <HUDControls
          filter={filter}
          onFilterChange={setFilter}
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          onFocusCore={handleFocusCore}
        />
      )}
    </div>
  );
}
