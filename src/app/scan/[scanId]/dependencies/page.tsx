'use client';
import ScanGate from '@/components/console/ScanGate';
import DepChainView from '@/components/console/views/DepChainView';

export default function DependenciesPage() {
  return <ScanGate>{(r) => <DepChainView result={r} />}</ScanGate>;
}
