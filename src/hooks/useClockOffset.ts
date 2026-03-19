import { useRef, useCallback } from 'react';

/**
 * NTP-style clock sync.
 * Takes 5 samples via /api/time, discards worst RTT, averages rest.
 * Returns serverNow() that gives server-aligned time.
 */
export function useClockOffset() {
  const offsetRef = useRef(0);

  const sync = useCallback(async () => {
    const samples: { offset: number; rtt: number }[] = [];

    for (let i = 0; i < 5; i++) {
      const t1 = Date.now();
      const res = await fetch('/api/time');
      const t4 = Date.now();
      const { serverTime: t2 } = await res.json();
      const rtt = t4 - t1;
      const offset = t2 - t1 - rtt / 2;
      samples.push({ offset, rtt });
      await new Promise(r => setTimeout(r, 50));
    }

    // Discard highest RTT, average the rest
    samples.sort((a, b) => a.rtt - b.rtt);
    const best = samples.slice(0, 4);
    offsetRef.current = best.reduce((sum, s) => sum + s.offset, 0) / best.length;
    console.log(`[ClockSync] offset=${offsetRef.current.toFixed(1)}ms, bestRTT=${best[0].rtt}ms`);
  }, []);

  const serverNow = useCallback(() => {
    return Date.now() + offsetRef.current;
  }, []);

  return { sync, serverNow, offsetRef };
}
