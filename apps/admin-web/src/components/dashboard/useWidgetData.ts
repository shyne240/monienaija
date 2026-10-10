import { useEffect, useRef, useState } from 'react';

export interface WidgetDataState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
}

/**
 * Generic, cancel-safe data-fetching hook shared by every dashboard widget. Defensive by design:
 * every widget on the page is always mounted at once (the page is a list of independently
 * authorized widgets), so one widget's fetcher throwing — or returning an unexpected shape from a
 * jest mock in a totally unrelated test — must never crash the rest of the dashboard or the page
 * it is embedded in.
 */
export function useWidgetData<T>(fetcher: () => Promise<T>, deps: unknown[]): WidgetDataState<T> {
  const [state, setState] = useState<WidgetDataState<T>>({ data: undefined, loading: true, error: null });
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    setState({ data: undefined, loading: true, error: null });

    (async () => {
      try {
        const result = await fetcher();
        if (!cancelledRef.current) {
          setState({ data: result, loading: false, error: null });
        }
      } catch (err: any) {
        if (!cancelledRef.current) {
          setState({ data: undefined, loading: false, error: err?.message || 'Failed to load widget data.' });
        }
      }
    })();

    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
