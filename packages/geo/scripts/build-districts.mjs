// Builds src/districts.json from ubigeo_distrito.csv of jmcastagnetto/ubigeo-peru-aumentado (MIT,
// notice in src/districts.LICENSE). Usage: pnpm --filter @ciudad-enduro/geo districts <path to the CSV>
// Source used: commit a783fa66effb16fa8f3321b49a3d5e71cab15a5c, CSV sha256
// 6a2cde8fb82e336285da4d684241450e8a36630e42799652c8d72b596ec252e4.
// Each row: [ubigeo (INEI), district, province, department, lat, lng]; lat/lng is the district
// capital point, null when the source has none.
import { readFileSync, writeFileSync } from 'node:fs';

/** RFC 4180 rows: quoted fields may hold commas, newlines and doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else field += c;
  }
  if (field || row.length) endRow();
  return rows;
}

// Spanish particles stay lower case inside a name ("Madre de Dios"), never as its first word ("La Mar").
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'y']);
const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);
const titleCase = (name) =>
  name
    .toLowerCase()
    .split(' ')
    .filter(Boolean)
    .map((word, i) => (i > 0 && PARTICLES.has(word) ? word : word.split('-').map(capital).join('-')))
    .join(' ');

const coordinate = (value) => (value === 'NA' || value === '' ? null : Math.round(Number(value) * 1e4) / 1e4);

const [csvPath] = process.argv.slice(2);
if (!csvPath) throw new Error('Usage: build-districts.mjs <ubigeo_distrito.csv>');
const [header, ...rows] = parseCsv(readFileSync(csvPath, 'utf8')).filter((row) => row.length > 1);
const col = (name) => {
  const index = header.indexOf(name);
  if (index < 0) throw new Error(`Missing column ${name}`);
  return index;
};
const [inei, district, province, department, lat, lng] = ['inei', 'distrito', 'provincia', 'departamento', 'latitude', 'longitude'].map(col);

const districts = rows
  // The one row without an INEI code (San Antonio, Moquegua) cannot be stored.
  .filter((row) => /^[0-9]{6}$/.test(row[inei]))
  .map((row) => [row[inei], titleCase(row[district]), titleCase(row[province]), titleCase(row[department]), coordinate(row[lat]), coordinate(row[lng])])
  .sort((a, b) => a[0].localeCompare(b[0]));

const out = new URL('../src/districts.json', import.meta.url);
writeFileSync(out, `[\n${districts.map((d) => JSON.stringify(d)).join(',\n')}\n]\n`);
console.log(`${districts.length} districts, ${districts.filter((d) => d[4] === null).length} without coordinates`);
