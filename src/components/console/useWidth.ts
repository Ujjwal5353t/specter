'use client';
import { useEffect, useRef, useState } from 'react';

/** Tracks an element's rendered width, for SVG scenes laid out in pixels. */
export function useWidth<T extends HTMLElement>(fallback = 1000) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** GET a JSON endpoint once per URL; errors surface as a message instead of throwing. */
export function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) setState({ url, data: null, error: body.error ?? `Request failed (${res.status})` });
        else setState({ url, data: body as T, error: null });
      })
      .catch(() => { if (alive) setState({ url, data: null, error: 'Network error' }); });
    return () => { alive = false; };
  }, [url]);
  // Until this URL's response lands, report loading rather than a previous URL's data.
  if (state.url !== url) return { data: null, error: null, loading: !!url };
  return { data: state.data, error: state.error, loading: false };
}
