// Run by gpx.spec.ts in a child process with a small heap: a 2-point GPX padded with N empty
// elements must parse without one object per element. Prints the point count.
import { parseGpx } from '../../src/trails/gpx/parse-gpx.js';

const n = Number(process.argv[2]);
const doc = `<gpx><trk><trkseg><trkpt lat="-9.09" lon="-78.52"/><trkpt lat="-9.1" lon="-78.52"><extensions>${'<e/>'.repeat(n)}</extensions></trkpt></trkseg></trk></gpx>`;
console.log(parseGpx(new TextEncoder().encode(doc)).points.length);
