import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    __turnstileOnLoad?: () => void;
  }
}

const SCRIPT_ID = 'cf-turnstile-script';
const SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__turnstileOnLoad&render=explicit';

function whenTurnstileReady(cb: () => void): void {
  if (window.turnstile) {
    cb();
    return;
  }
  const prev = window.__turnstileOnLoad;
  window.__turnstileOnLoad = () => {
    prev?.();
    cb();
  };
  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    document.head.appendChild(script);
  }
}

interface TurnstileProps {
  siteKey: string;
  onToken: (token: string | null) => void;
  /** Increment to force a widget reset (tokens are single-use). */
  resetKey: number;
}

/** Explicit-render Cloudflare Turnstile widget. */
export default function Turnstile({ siteKey, onToken, resetKey }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    whenTurnstileReady(() => {
      if (cancelled || !containerRef.current || widgetIdRef.current !== null) return;
      widgetIdRef.current = window.turnstile!.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        'expired-callback': () => onToken(null),
        'error-callback': () => onToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetIdRef.current !== null) {
        window.turnstile?.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  useEffect(() => {
    if (resetKey > 0 && widgetIdRef.current !== null) {
      onToken(null);
      window.turnstile?.reset(widgetIdRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  return <div ref={containerRef} className="turnstile-box" aria-label="Bot check" />;
}
