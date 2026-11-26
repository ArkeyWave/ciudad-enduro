'use client';

import { useRef } from 'react';
import { Icon } from './Icon';

/** The FAB "Registrar ruta": a sheet (a modal `<dialog>`) with Sendero and Vista (plan §8 G1). */
export function FabSheet() {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" className="nav-fab" aria-label="Registrar ruta" aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <Icon name="plus" size={26} strokeWidth={2.5} />
      </button>
      {/* A click on the backdrop lands on the dialog itself and closes it; Escape closes it natively. */}
      <dialog
        ref={dialog}
        className="sheet-dialog"
        aria-labelledby="fab-sheet-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) close();
        }}
      >
        <div className="sheet">
          <div className="row-between">
            <h2 id="fab-sheet-title">Registrar</h2>
            <button type="button" className="back" aria-label="Cerrar" onClick={close}>
              <Icon name="close" size={20} />
            </button>
          </div>
          <a href="/rutas/nueva" className="opt">
            <span className="o-icon">
              <Icon name="route" />
            </span>
            <span className="o-name">Sendero</span>
          </a>
          <a href="/vistas/nueva" className="opt">
            <span className="o-icon">
              <Icon name="eye" />
            </span>
            <span className="o-name">Vista</span>
          </a>
        </div>
      </dialog>
    </>
  );
}
