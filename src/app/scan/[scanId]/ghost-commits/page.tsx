'use client';
import ScanGate from '@/components/console/ScanGate';
import GhostCommitView from '@/components/console/views/GhostCommitView';

export default function GhostCommitsPage() {
  return <ScanGate>{(r) => <GhostCommitView result={r} />}</ScanGate>;
}
