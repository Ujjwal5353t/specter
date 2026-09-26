'use client';
import ScanGate from '@/components/console/ScanGate';
import EnvTraceView from '@/components/console/views/EnvTraceView';

export default function EnvTracePage() {
  return <ScanGate>{(r) => <EnvTraceView result={r} />}</ScanGate>;
}
