import { isAdmin } from '../lib/roles';
import { currentUser } from '../lib/session';
import { Icon } from './Icon';
import { NavLink } from './NavLink';

/** The nav items of a signed-in user: the "Registrar ruta" FAB and "Mis rutas"; an admin also gets "Revisión". */
export async function UserNavItems() {
  const me = await currentUser();
  if (!me) return null;
  return (
    <>
      <NavLink href="/rutas/nueva" className="nav-fab" label="Registrar ruta">
        <Icon name="plus" size={26} strokeWidth={2.5} />
      </NavLink>
      <NavLink href="/mis-rutas" className="nav-item">
        <Icon name="route" />
        <span>Mis rutas</span>
      </NavLink>
      {isAdmin(me) && (
        <NavLink href="/admin/rutas" className="nav-item">
          <Icon name="list" />
          <span>Revisión</span>
        </NavLink>
      )}
    </>
  );
}
