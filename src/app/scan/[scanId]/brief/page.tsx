'use client';
import ScanGate from '@/components/console/ScanGate';
import BriefView from '@/components/console/views/BriefView';

export default function BriefPage() {
  return <ScanGate>{(r) => <BriefView result={r} />}</ScanGate>;
}
