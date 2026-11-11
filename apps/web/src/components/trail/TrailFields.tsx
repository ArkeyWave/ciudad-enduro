import type { TrailDetail } from 'api-client';
import { CITIES, DIFFICULTIES, difficultyLabel, TRAIL_TYPES, trailTypeLabel } from '../../lib/labels';
import { input } from '../sign-in/styles';

export const column = { display: 'flex', flexDirection: 'column', gap: 12 } as const;

// Limits of the API DTOs (NAME_MAX, DESCRIPTION_MAX).
const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

type Values = Pick<TrailDetail, 'name' | 'city' | 'difficulty' | 'type' | 'description'>;

/** The metadata fields of the upload and the edit form; the names are the API field names. */
export function TrailFields({ values }: { values?: Values }) {
  return (
    <>
      <label style={column}>
        Nombre
        <input name="name" required maxLength={NAME_MAX} defaultValue={values?.name} style={input} />
      </label>
      <label style={column}>
        Ciudad
        <select name="city" required defaultValue={values?.city} style={input}>
          {CITIES.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </label>
      <label style={column}>
        Dificultad
        <select name="difficulty" required defaultValue={values?.difficulty} style={input}>
          {DIFFICULTIES.map((slug) => (
            <option key={slug} value={slug}>
              {difficultyLabel(slug)}
            </option>
          ))}
        </select>
      </label>
      <label style={column}>
        Tipo
        <select name="type" required defaultValue={values?.type} style={input}>
          {TRAIL_TYPES.map((slug) => (
            <option key={slug} value={slug}>
              {trailTypeLabel(slug)}
            </option>
          ))}
        </select>
      </label>
      <label style={column}>
        Descripción
        <textarea name="description" rows={4} maxLength={DESCRIPTION_MAX} defaultValue={values?.description} style={input} />
      </label>
    </>
  );
}
