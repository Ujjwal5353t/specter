'use client';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

// Safe to use ssr: false here because we are inside a 'use client' file
const SpectreScene = dynamic(() => import('./SpectreScene'), { ssr: false });

export default function GlobalScene() {
  const pathname = usePathname();
  // The landing and pricing pages paint an opaque background over this layer,
  // so mounting the WebGL scene there would render nothing while still costing
  // a render loop. Scan pages are unchanged.
  if (pathname === '/' || pathname === '/pricing') return null;
  return <SpectreScene />;
}