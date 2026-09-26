import type { Metadata } from 'next';
import ReportsView from '@/components/console/views/ReportsView';

export const metadata: Metadata = { title: 'Reports — Specter' };

export default function ReportsPage() {
  return <ReportsView />;
}
