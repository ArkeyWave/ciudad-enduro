'use client';

// Shown when a page fails on the server (for example, the API is down or too slow). It renders a
// fixed message: never the error, which could carry an internal host or a stack trace.
export default function ErrorPage() {
  return (
    <main className="page">
      <div className="head" role="alert">
        <h1 className="h-display">No pudimos cargar esta página</h1>
      </div>
      <a href="/" className="cta">
        Reintentar
      </a>
    </main>
  );
}
