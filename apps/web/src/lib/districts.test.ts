import type { District } from 'api-client';
import { describe, expect, it } from 'vitest';
import { choose, districtLabel, districtLine, edit, gpxStart, initialChoice, suggest, suggestionPoint } from './districts';

const chimbote: District = { ubigeo: '021801', name: 'Chimbote', province: 'Santa', department: 'Ancash' };
const nuevo: District = { ubigeo: '021809', name: 'Nuevo Chimbote', province: 'Santa', department: 'Ancash' };
const trujillo: District = { ubigeo: '130101', name: 'Trujillo', province: 'Trujillo', department: 'La Libertad' };

describe('the district choice (plan §10.1 A7)', () => {
  it('takes a suggestion while nothing is saved or chosen, and a later one replaces it', () => {
    const first = suggest(initialChoice(), chimbote);
    expect(first.value).toEqual(chimbote);
    expect(suggest(first, trujillo).value).toEqual(trujillo);
  });

  it('never replaces a saved value', () => {
    expect(suggest(initialChoice(nuevo), chimbote).value).toEqual(nuevo);
  });

  it('never replaces a value the rider chose', () => {
    const chosen = choose(suggest(initialChoice(), chimbote), trujillo);
    expect(suggest(chosen, chimbote).value).toEqual(trujillo);
  });

  it('stops suggesting once the rider types', () => {
    expect(suggest(edit(initialChoice()), chimbote).value).toBeNull();
  });

  it('keeps the current value when there is nothing to suggest', () => {
    expect(suggest(suggest(initialChoice(), chimbote), undefined).value).toEqual(chimbote);
  });
});

describe('suggestionPoint', () => {
  const start = { lat: -9.07, lng: -78.59 };
  const fix = { lat: -8.1, lng: -79.03 };
  it('prefers the trail start to the device fix', () => {
    expect(suggestionPoint(start, fix)).toEqual(start);
  });
  it('falls back to the device fix, then to nothing', () => {
    expect(suggestionPoint(null, fix)).toEqual(fix);
    expect(suggestionPoint(null, null)).toBeNull();
  });
});

describe('districtLabel', () => {
  it('names the district, its province and department', () => {
    expect(districtLabel(chimbote)).toBe('Chimbote, Santa, Ancash');
  });
});

describe('districtLine', () => {
  const trails = (...districts: District[]) => districts.map((district) => ({ district }));
  it('lists each district once, in list order', () => {
    expect(districtLine(trails(trujillo, chimbote, trujillo))).toBe('Trujillo · Chimbote');
  });
  it('shows at most three names and counts the rest', () => {
    const lima: District = { ubigeo: '150101', name: 'Lima', province: 'Lima', department: 'Lima' };
    const ate: District = { ubigeo: '150103', name: 'Ate', province: 'Lima', department: 'Lima' };
    expect(districtLine(trails(trujillo, chimbote, nuevo))).toBe('Trujillo · Chimbote · Nuevo Chimbote');
    expect(districtLine(trails(trujillo, chimbote, nuevo, lima, ate))).toBe('Trujillo · Chimbote · Nuevo Chimbote y 2 más');
  });
  it('is empty without trails', () => {
    expect(districtLine([])).toBe('');
  });
});

describe('gpxStart', () => {
  it('reads the first track point, in either attribute order', () => {
    expect(gpxStart('<gpx><trk><trkseg><trkpt lat="-9.09" lon="-78.52"/><trkpt lat="1" lon="2"/>')).toEqual({ lat: -9.09, lng: -78.52 });
    expect(gpxStart("<trkpt lon='-79.03' lat='-8.11'><ele>3</ele></trkpt>")).toEqual({ lat: -8.11, lng: -79.03 });
  });
  it('gives nothing without a usable point', () => {
    expect(gpxStart('<gpx><wpt lat="-9" lon="-78"/></gpx>')).toBeNull();
    expect(gpxStart('<trkpt lat="x" lon="-78"/>')).toBeNull();
    expect(gpxStart('<trkpt lat="" lon="-78"/>')).toBeNull();
  });
});
