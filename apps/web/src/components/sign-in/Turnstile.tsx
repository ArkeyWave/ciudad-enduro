import Script from 'next/script';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Cloudflare Turnstile, explicit rendering. The API refuses a token whose action is not this one
// (apps/api auth.options.ts, TURNSTILE_ACTION).
const ACTION = 'send_code';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/**
 * The current token, or null while there is none. A token is good for one send: `reset` clears
 * it and has the widget issue a new one.
 */
export function useTurnstile() {
  const [token, setToken] = useState<string | null>(null);
  const widgetId = useRef<string | null>(null);
  const reset = useCallback(() => {
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, []);
  return { token, setToken, widgetId, reset };
}

/** `onError`: the widget failed, or its script could not load; there is no token until it recovers. */
export function TurnstileWidget({
  siteKey,
  onToken,
  onError,
  widgetId,
}: {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError: () => void;
  widgetId: RefObject<string | null>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded || !container.current || !window.turnstile) return;
    const id = window.turnstile.render(container.current, {
      sitekey: siteKey,
      action: ACTION,
      language: 'es',
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(null),
      'error-callback': () => {
        onToken(null);
        onError();
      },
    });
    widgetId.current = id;
    return () => {
      window.turnstile?.remove(id);
      widgetId.current = null;
    };
  }, [loaded, siteKey, onToken, onError, widgetId]);

  return (
    <>
      <Script src={SCRIPT_URL} onReady={() => setLoaded(true)} onError={onError} />
      <div ref={container} />
    </>
  );
}
