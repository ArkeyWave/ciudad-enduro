import { isAdmin } from '../lib/roles';
import { currentUser } from '../lib/session';
import { Icon } from './Icon';
import { NavLink } from './NavLink';

/**
 * The nav items of a signed-in user, in visual order: "Mis rutas", the "Registrar ruta" FAB, and for an
 * admin "Revisión".
 */
export async function UserNavItems() {
  const me = await currentUser();
  if (!me) return null;
  return (
    <>
      <NavLink href="/mis-rutas" className="nav-item nav-mine">
        <Icon name="route" />
        <span>Mis rutas</span>
      </NavLink>
      <NavLink href="/rutas/nueva" className="nav-fab" label="Registrar ruta">
        <Icon name="plus" size={26} strokeWidth={2.5} />
      </NavLink>
      {isAdmin(me) && (
        <NavLink href="/admin/rutas" className="nav-item nav-review">
          <Icon name="list" />
          <span>Revisión</span>
        </NavLink>
      )}
    </>
  );
}
