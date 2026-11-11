import { currentUser } from '../../lib/session';

/** No published trail yet: a signed-in user can register one. */
export async function EmptyTrails() {
  const me = await currentUser();
  return (
    <div className="card card-pad empty" data-testid="empty-trails">
      <p>Aún no hay senderos publicados.</p>
      {me && (
        <a href="/rutas/nueva" className="cta">
          Registrar ruta
        </a>
      )}
    </div>
  );
}
