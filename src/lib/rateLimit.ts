const map = new Map<string, { count: number; resetAt: number }>();

const SWEEP_EVERY_MS = 60 * 1000;
const MAX_ENTRIES = 10_000;
let lastSweep = 0;

// Drops expired entries so the map can't grow forever, at most once a minute
function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, entry] of map) {
    if (entry.resetAt < now) map.delete(key);
  }
}

export function rateLimit(ip: string, max = 5, windowMs = 60 * 60 * 1000): boolean {
  const now = Date.now();
  sweep(now);
  const entry = map.get(ip);
  if (!entry || entry.resetAt < now) {
    // Safety valve if a flood of distinct IPs outpaces the sweep: evict the oldest
    if (!map.has(ip) && map.size >= MAX_ENTRIES) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
    map.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= max) return false;
  entry.count++;
  return true;
}
