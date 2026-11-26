import type { TrailDetail } from 'api-client';
import { DIFFICULTIES, difficultyLabel, TRAIL_TYPES, trailTypeLabel } from '../../lib/labels';
import type { Point } from '../../lib/tracer';
import { DistrictField } from './DistrictField';

// Limits of the API DTOs (NAME_MAX, DESCRIPTION_MAX).
const NAME_MAX = 80;
const DESCRIPTION_MAX = 2000;

type Values = Pick<TrailDetail, 'name' | 'district' | 'difficulty' | 'type' | 'description'>;

/**
 * The metadata fields of the upload and the edit form; the names are the API field names.
 * `suggestion` is the point the district is suggested from (plan §10.1 A7).
 */
export function TrailFields({ values, suggestion }: { values?: Values; suggestion?: Point | null }) {
  return (
    <>
      <label className="field">
        Nombre
        <input name="name" required maxLength={NAME_MAX} defaultValue={values?.name} />
      </label>
      <DistrictField saved={values?.district} suggestion={suggestion} />
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
