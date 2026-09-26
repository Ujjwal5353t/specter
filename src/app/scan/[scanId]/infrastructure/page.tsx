'use client';
import ScanGate from '@/components/console/ScanGate';
import LayerScanView from '@/components/console/views/LayerScanView';

export default function InfrastructurePage() {
  return <ScanGate>{(r) => <LayerScanView result={r} />}</ScanGate>;
}
