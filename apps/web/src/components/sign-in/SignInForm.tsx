'use client';

import { useCallback, useState, type SubmitEvent } from 'react';
import { sendCode, startGoogleSignIn, verifyCode } from '../../lib/auth-client';
import { MESSAGES, sendErrorMessage, verifyErrorMessage } from '../../lib/auth-errors';
import { TurnstileWidget, useTurnstile } from './Turnstile';

export function SignInForm({ initialMessage, siteKey }: { initialMessage: string | null; siteKey: string }) {
  const turnstile = useTurnstile();
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  // Every send, the resend and a retry included, uses its own token: the API refuses a used one.
  const requestCode = () =>
    run(async () => {
      if (!turnstile.token) return setMessage(MESSAGES.captcha);
      let result;
      try {
        result = await sendCode(email, turnstile.token);
      } finally {
        turnstile.reset();
      }
      if (!result.ok) return setMessage(sendErrorMessage(result));
      setCodeSent(true);
    });
  const canSend = !busy && turnstile.token !== null;
  // Stable, so the widget is not rendered again on every form render.
  const showCaptchaError = useCallback(() => setMessage(MESSAGES.captcha), []);

  const submitCode = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const otp = (event.currentTarget.elements.namedItem('otp') as HTMLInputElement).value;
    void run(async () => {
      const result = await verifyCode(email, otp);
      if (!result.ok) return setMessage(verifyErrorMessage(result));
      window.location.assign('/');
    });
  };

  const google = () =>
    run(async () => {
      const result = await startGoogleSignIn(window.location.origin);
      if (!result.ok) return setMessage(result.status === 429 ? sendErrorMessage(result) : MESSAGES.googleFailed);
      if (!result.data.url) return setMessage(MESSAGES.googleFailed);
      window.location.assign(result.data.url);
    });

  return (
    <div className="form">
      {codeSent ? (
        <form onSubmit={submitCode} className="form">
          <p className="notice">Te enviamos un código a {email}.</p>
          <label className="field">
            Código
            <input
              name="otp"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
            />
          </label>
          <button type="submit" disabled={busy} className="cta">
            Ingresar
          </button>
          <button type="button" disabled={!canSend} onClick={() => void requestCode()} className="cta ghost">
            Enviar otro código
          </button>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void requestCode();
          }}
          className="form"
        >
          <label className="field">
            Correo
            <input
              type="email"
              name="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value.trim())}
            />
          </label>
          <button type="submit" disabled={!canSend} className="cta">
            Enviar código
          </button>
        </form>
      )}
      {/* Mounted once for both steps, so the resend gets a fresh token from the same widget. */}
      <TurnstileWidget siteKey={siteKey} onToken={turnstile.setToken} onError={showCaptchaError} widgetId={turnstile.widgetId} />
      <button type="button" disabled={busy} onClick={() => void google()} className="cta ghost">
        Continuar con Google
      </button>
      {message && (
        <p role="alert" className="alert">
          {message}
        </p>
      )}
    </div>
  );
}
