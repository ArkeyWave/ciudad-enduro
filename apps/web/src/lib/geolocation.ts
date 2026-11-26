import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Fix } from './tracer';

// One watchPosition for a page (plan §10 L3-4): started on demand, stopped on unmount.
export type GeoState =
  | { status: 'idle' | 'searching' | 'denied' | 'unavailable'; fix: null }
  | { status: 'active'; fix: Fix };

type GeoEvent =
  | { type: 'start' }
  | { type: 'unsupported' }
  | { type: 'fix'; fix: Fix }
  | { type: 'error'; denied: boolean }
  | { type: 'hidden' };

export const IDLE: GeoState = { status: 'idle', fix: null };

export function geoReducer(state: GeoState, event: GeoEvent): GeoState {
  switch (event.type) {
    case 'start':
      return { status: 'searching', fix: null };
    case 'unsupported':
      return { status: 'unavailable', fix: null };
    case 'fix':
      // The watch is cleared on a denial; a fix already queued must not revive it.
      return state.status === 'searching' || state.status === 'active' ? { status: 'active', fix: event.fix } : state;
    case 'error':
      // Position unavailable or a timeout is transient (Chromium sends one on every position change):
      // the watch goes on. Only a denied permission ends it.
      return { status: event.denied ? 'denied' : 'searching', fix: null };
    case 'hidden':
      // A hidden page gets no position updates: its fix is stale on return.
      return state.status === 'active' ? { status: 'searching', fix: null } : state;
  }
}

export function useGeolocation() {
  const [state, dispatch] = useReducer(geoReducer, IDLE);
  const watch = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watch.current !== null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  }, []);

  const start = useCallback(() => {
    if (watch.current !== null) return;
    if (!('geolocation' in navigator)) return dispatch({ type: 'unsupported' });
    dispatch({ type: 'start' });
    watch.current = navigator.geolocation.watchPosition(
      ({ coords, timestamp }) =>
        dispatch({ type: 'fix', fix: { lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy, at: timestamp } }),
      (error) => {
        const denied = error.code === error.PERMISSION_DENIED;
        if (denied) stop();
        dispatch({ type: 'error', denied });
      },
      { enableHighAccuracy: true, maximumAge: 0 },
    );
  }, [stop]);

  /** Starts only when the permission is already granted: no prompt (plan §10.1 A7). */
  const startIfGranted = useCallback(() => {
    void navigator.permissions
      ?.query({ name: 'geolocation' })
      .then((permission) => {
        if (permission.state === 'granted') start();
      })
      .catch(() => undefined);
  }, [start]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') dispatch({ type: 'hidden' });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stop();
    };
  }, [stop]);

  return { ...state, start, startIfGranted };
}
