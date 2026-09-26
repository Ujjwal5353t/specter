'use client';
import ScanGate from '@/components/console/ScanGate';
import ApiBleedView from '@/components/console/views/ApiBleedView';

export default function ApiSurfacePage() {
  return <ScanGate>{(r) => <ApiBleedView result={r} />}</ScanGate>;
}
