import { useCallback, useEffect, useState } from 'react';

import { describeError } from './institution-console-support';

/**
 * Cancel-safe loader for console sections. Each section owns its request so one failing read
 * (for example a role that may not see platform attribution data) never blanks the whole screen.
 */
export interface ConsoleAsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
}

export function useConsoleData<T>(
  fetcher: () => Promise<T>,
  deps: unknown[],
  fallback: string,
): ConsoleAsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<ConsoleAsyncState<T>>({
    data: undefined,
    loading: true,
    error: null,
  });
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setState((previous) => ({ ...previous, loading: true, error: null }));
    fetcher()
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (active) setState({ data: undefined, loading: false, error: describeError(error, fallback) });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, revision]);

  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { ...state, reload };
}
