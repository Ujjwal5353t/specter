'use client';
import ScanGate from '@/components/console/ScanGate';
import SecretsView from '@/components/console/views/SecretsView';

export default function SecretsPage() {
  return <ScanGate>{(r) => <SecretsView result={r} />}</ScanGate>;
}
