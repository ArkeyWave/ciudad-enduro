import { describe, expect, it } from 'vitest';
import { DISTRICTS, districtByUbigeo, nearestDistrict, searchDistricts } from '../src/index.js';

const codes = (list: readonly { ubigeo: string }[]) => list.map((d) => d.ubigeo);

describe('the district list', () => {
  it('has every district once, with a six-digit code and no NA row', () => {
    expect(DISTRICTS).toHaveLength(1892);
    expect(new Set(codes(DISTRICTS)).size).toBe(1892);
    expect(DISTRICTS.every((d) => /^[0-9]{6}$/.test(d.ubigeo))).toBe(true);
  });

  it('builds title-case names with lower-case particles', () => {
    expect(districtByUbigeo('021801')).toEqual({ ubigeo: '021801', name: 'Chimbote', province: 'Santa', department: 'Ancash', lat: -9.0417, lng: -78.6078 });
    expect(districtByUbigeo('170101')?.department).toBe('Madre de Dios');
    expect(districtByUbigeo('130101')?.department).toBe('La Libertad');
  });

  it('knows no unknown code', () => {
    expect(districtByUbigeo('999999')).toBeUndefined();
  });
});

describe('searchDistricts', () => {
  it.each(['ancash', 'ANCASH', 'Áncash'])('folds case and accents: %s finds Ancash', (query) => {
    const found = searchDistricts(query);
    expect(found).toHaveLength(8);
    expect(found.every((d) => d.department === 'Ancash')).toBe(true);
  });

  it('folds the accents of the data too', () => {
    // The source spells San Juan de Chacña with an ñ.
    expect(codes(searchDistricts('chacna'))).toContain('030411');
  });

  it('puts names that start with the query first, then names that contain it', () => {
    // In code order the Santa Rosa of Amazonas (0106xx) comes before Rosario (0901xx).
    const names = searchDistricts('rosa').map((d) => d.name);
    expect(names.slice(0, 3)).toEqual(['Rosario', 'Rosa Panduro', 'Rosaspata']);
    expect(names.slice(3).every((name) => name === 'Santa Rosa')).toBe(true);
  });

  it('puts a name match before a match on the province only', () => {
    expect(searchDistricts('chimbote').map((d) => d.ubigeo)).toEqual(['021801', '021809']);
    // "cajamarca" also matches the 126 districts of the department; Nueva Cajamarca (San Martín) comes second.
    expect(searchDistricts('cajamarca').map((d) => d.name).slice(0, 2)).toEqual(['Cajamarca', 'Nueva Cajamarca']);
  });

  it('matches every word across district, province and department', () => {
    expect(codes(searchDistricts('trujillo libertad'))).toContain('130101');
    expect(searchDistricts('trujillo ancash')).toEqual([]);
  });

  it('returns nothing for a blank query', () => {
    expect(searchDistricts('  ')).toEqual([]);
  });
});

describe('nearestDistrict', () => {
  it("gives Chimbote for the tracer's default centre", () => {
    expect(nearestDistrict({ lat: -9.0745, lng: -78.5936 })?.ubigeo).toBe('021801');
  });

  it('gives Trujillo next to its capital point', () => {
    expect(nearestDistrict({ lat: -8.101, lng: -79.03 })?.ubigeo).toBe('130101');
  });

  it('never returns a district without coordinates', () => {
    // A point at 0,0 is nearest to a row whose missing coordinates were read as zero.
    expect(nearestDistrict({ lat: 0, lng: 0 })?.lat).not.toBeNull();
    // Santa María de Huachipa has no capital point in the source.
    expect(nearestDistrict({ lat: -12.0, lng: -76.93 })?.ubigeo).not.toBe('150144');
  });
});
