import { useCallback, useSyncExternalStore } from 'react';

/** True while the CSS media query matches; re-renders only when it flips. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia?.(query);
      mq?.addEventListener('change', cb);
      return () => mq?.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false, () => false);
}

/** Phone layout: below Tailwind's md breakpoint, where the bottom tab bar shows. */
export const PHONE_QUERY = '(max-width: 767px)';
