import { SignInForm } from '../../components/sign-in/SignInForm';
import { googleErrorMessage } from '../../lib/auth-errors';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  // Better Auth sends a failed Google sign-in back here with ?error=<code>.
  const { error } = await searchParams;
  // Read per request, not inlined at build (no NEXT_PUBLIC_): one image serves every host.
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  if (!siteKey) throw new Error('TURNSTILE_SITE_KEY is required');
  return (
    <main className="page narrow">
      <div className="head">
        <h1 className="h-display">Ingresar</h1>
      </div>
      <SignInForm initialMessage={googleErrorMessage(typeof error === 'string' ? error : null)} siteKey={siteKey} />
    </main>
  );
}
