import type { Metadata } from 'next';
import MonitoringView from '@/components/console/views/MonitoringView';

export const metadata: Metadata = { title: 'Monitoring — Specter' };

export default function MonitoringPage() {
  return <MonitoringView />;
}
