'use client';

// Shown when a page fails on the server (for example, the API is down or too slow). It renders a
// fixed message: never the error, which could carry an internal host or a stack trace.
export default function ErrorPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ color: '#CCFF00' }}>No pudimos cargar esta página</h1>
      <a href="/" style={{ color: '#CCFF00' }}>
        Reintentar
      </a>
    </main>
  );
}
