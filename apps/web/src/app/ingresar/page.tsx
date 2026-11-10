import { SignInForm } from '../../components/sign-in/SignInForm';
import { googleErrorMessage } from '../../lib/auth-errors';

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string | string[] }> }) {
  // Better Auth sends a failed Google sign-in back here with ?error=<code>.
  const { error } = await searchParams;
  return (
    <main style={{ maxWidth: 420, margin: '0 auto', padding: 16 }}>
      <h1 style={{ color: '#CCFF00' }}>Ingresar</h1>
      <SignInForm initialMessage={googleErrorMessage(typeof error === 'string' ? error : null)} />
    </main>
  );
}
