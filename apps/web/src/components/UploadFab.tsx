import { currentUser } from '../lib/session';
import { Icon } from './Icon';

/** The centre FAB of the nav: every signed-in user can register a route; anonymous users see none. */
export async function UploadFab() {
  if (!(await currentUser())) return null;
  return (
    <a href="/rutas/nueva" className="nav-fab" aria-label="Registrar ruta">
      <Icon name="plus" size={26} strokeWidth={2.5} />
    </a>
  );
}
