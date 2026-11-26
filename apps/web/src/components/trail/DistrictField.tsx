'use client';

import type { District } from 'api-client';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { cancel, choose, districtLabel, edit, initialChoice, suggest, type Choice } from '../../lib/districts';
import type { Point } from '../../lib/tracer';

type Geo = typeof import('@ciudad-enduro/geo');

const toDistrict = ({ ubigeo, name, province, department }: District): District => ({ ubigeo, name, province, department });

/**
 * "Distrito" (plan §10 L3-3): an ARIA 1.2 combobox over every district of Peru. The list loads only
 * on the form pages (dynamic import). A saved or chosen value is never replaced; otherwise the
 * district nearest to `suggestion` is the default. The form gets the code in a hidden `ubigeo` input.
 */
export function DistrictField({ saved, suggestion }: { saved?: District; suggestion?: Point | null }) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement>(null);
  const [geo, setGeo] = useState<Geo | null>(null);
  const [choice, setChoice] = useState<Choice>(() => initialChoice(saved && toDistrict(saved)));
  const [text, setText] = useState(saved ? districtLabel(saved) : '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    void import('@ciudad-enduro/geo').then(setGeo);
  }, []);

  // A suggestion changes the value only while it is not locked (lib/districts.ts).
  useEffect(() => {
    if (!geo || !suggestion) return;
    const near = geo.nearestDistrict(suggestion);
    setChoice((current) => {
      const next = suggest(current, near && toDistrict(near));
      if (next !== current && next.value) setText(districtLabel(next.value));
      return next;
    });
  }, [geo, suggestion]);

  const options = open && geo ? geo.searchDistricts(text).map(toDistrict) : [];
  const valid = choice.value !== null && text === districtLabel(choice.value);

  useEffect(() => {
    input.current?.setCustomValidity(valid || text === '' ? '' : 'Elige un distrito de la lista.');
  }, [valid, text]);

  const pick = (district: District) => {
    setChoice((current) => choose(current, district));
    setText(districtLabel(district));
    setOpen(false);
  };

  // Escape puts the value back, with the lock it had before the typing (lib/districts.ts). A blur
  // keeps the typed text, so the custom validity refuses a form whose text is not the value.
  const revert = () => {
    setOpen(false);
    if (!choice.value) return;
    setText(districtLabel(choice.value));
    setChoice(cancel);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
    } else if (event.key === 'Enter' && open && options[active]) {
      event.preventDefault();
      pick(options[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      revert();
    }
  };

  return (
    <div className="field combobox">
      <label htmlFor={id}>Distrito</label>
      <input
        ref={input}
        id={id}
        role="combobox"
        aria-expanded={options.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={options[active] ? `${id}-${options[active].ubigeo}` : undefined}
        autoComplete="off"
        required
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setChoice(edit);
          setOpen(true);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        onBlur={revert}
      />
      <input type="hidden" name="ubigeo" value={valid ? (choice.value?.ubigeo ?? '') : ''} />
      <ul id={listId} role="listbox" aria-label="Distritos" className="combobox-list" hidden={options.length === 0}>
        {options.map((d, i) => (
          <li
            key={d.ubigeo}
            id={`${id}-${d.ubigeo}`}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: the input's blur would close the list first.
            onMouseDown={(event) => {
              event.preventDefault();
              pick(d);
            }}
          >
            {d.name}{' '}
            <span className="muted">
              {d.province}, {d.department}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
