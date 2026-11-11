import type { TrailDetail } from 'api-client';
import { CITIES, DIFFICULTIES, difficultyLabel, TRAIL_TYPES, trailTypeLabel } from '../../lib/labels';

// Limits of the API DTOs (NAME_MAX, DESCRIPTION_MAX).
const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

type Values = Pick<TrailDetail, 'name' | 'city' | 'difficulty' | 'type' | 'description'>;

/** The metadata fields of the upload and the edit form; the names are the API field names. */
export function TrailFields({ values }: { values?: Values }) {
  return (
    <>
      <label className="field">
        Nombre
        <input name="name" required maxLength={NAME_MAX} defaultValue={values?.name} />
      </label>
      <label className="field">
        Ciudad
        <select name="city" required defaultValue={values?.city}>
          {CITIES.map((city) => (
            <option key={city} value={city}>
              {city}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Dificultad
        <select name="difficulty" required defaultValue={values?.difficulty}>
          {DIFFICULTIES.map((slug) => (
            <option key={slug} value={slug}>
              {difficultyLabel(slug)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Tipo
        <select name="type" required defaultValue={values?.type}>
          {TRAIL_TYPES.map((slug) => (
            <option key={slug} value={slug}>
              {trailTypeLabel(slug)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Descripción
        <textarea name="description" rows={4} maxLength={DESCRIPTION_MAX} defaultValue={values?.description} />
      </label>
    </>
  );
}
