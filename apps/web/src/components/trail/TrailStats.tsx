import type { Difficulty } from 'api-client';
import { difficultyLabel } from '../../lib/labels';
import { formatDistance, formatDrop, formatGrade, gradeDeg, shownDrop } from '../../lib/profile';

/** A stat as in the prototype: the value in Bebas with a small unit, the label under it. */
function Stat({ label, value }: { label: string; value: string }) {
  const space = value.lastIndexOf(' ');
  return (
    <div className="stat" data-stat={label}>
      <span className="lbl">{label}</span>
      <span className="val">
        {space > 0 ? value.slice(0, space) : value}
        {space > 0 && <u>{value.slice(space)}</u>}
      </span>
    </div>
  );
}

type StatsProps = {
  type: string;
  distanceM: number | null;
  gainM: number | null | undefined;
  lossM: number | null | undefined;
};

/** Distancia, Desnivel, Pendiente (mean grade in degrees); a missing value hides its stat. */
export function TrailStats({ type, distanceM, gainM, lossM }: StatsProps) {
  const drop = shownDrop(type, gainM, lossM);
  const grade = gradeDeg(drop, distanceM);
  return (
    <div className="stats">
      {distanceM !== null && <Stat label="Distancia" value={formatDistance(distanceM)} />}
      {drop !== null && <Stat label="Desnivel" value={formatDrop(drop)} />}
      {grade !== null && <Stat label="Pendiente" value={formatGrade(grade)} />}
    </div>
  );
}

const PILL = { facil: 'facil', intermedio: 'inter', dificil: 'dificil' } satisfies Record<Difficulty, string>;

export function DifficultyPill({ difficulty }: { difficulty: Difficulty }) {
  return (
    <span className={`diff-pill ${PILL[difficulty]}`}>
      <span className="dot" />
      {difficultyLabel(difficulty)}
    </span>
  );
}
