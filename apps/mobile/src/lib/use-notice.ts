import { useCallback, useEffect, useRef, useState } from 'react';

/** One transient message at a time (toast). */
export function useNotice(ms = 3200) {
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (m: string) => {
      setNotice(m);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setNotice(null), ms);
    },
    [ms],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return { notice, show };
}
