import { useCallback, useEffect, useRef, useState } from 'react';
import { backend, errorMessage, type LiveTopic } from '@/services';

interface Options {
  /** Re-run when the backend reports a change on any of these topics. */
  live?: LiveTopic[];
  /** Fallback polling interval in ms (covers missed realtime messages). */
  pollMs?: number;
}

/**
 * Loads server data and keeps it fresh. The server stays the source of truth:
 * live updates trigger a re-fetch instead of patching numbers in React state.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], opts: Options = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const value = await fnRef.current();
      if (id === seq.current) {
        setData(value);
        setError(null);
      }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const topics = opts.live?.join(',') ?? '';
  useEffect(() => {
    if (!topics) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wanted = new Set(topics.split(','));
    const unsubscribe = backend.subscribe((t) => {
      if (!wanted.has(t)) return;
      // Coalesce bursts (e.g. many passages in one second) into one fetch.
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void reload();
      }, 150);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [topics, reload]);

  useEffect(() => {
    if (!opts.pollMs) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, opts.pollMs);
    return () => clearInterval(t);
  }, [opts.pollMs, reload]);

  return { data, error, loading, reload, setData };
}
