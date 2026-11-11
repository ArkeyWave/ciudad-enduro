import { describe, expect, it } from 'vitest';
import { profilePolyline, sampleProfile, slopePct } from './profile';

describe('profilePolyline', () => {
  it('scales distance to the width and elevation to the height, highest point at the top', () => {
    expect(
      profilePolyline(
        [
          [0, 100],
          [500, 150],
          [1000, 120],
        ],
        200,
        100,
      ),
    ).toBe('0,100 100,0 200,60');
  });

  it('draws a flat profile as a flat line across the middle', () => {
    expect(
      profilePolyline(
        [
          [0, 80],
          [300, 80],
          [600, 80],
        ],
        200,
        100,
      ),
    ).toBe('0,50 100,50 200,50');
  });

  it('draws a profile with no distance as a flat line across the box', () => {
    expect(
      profilePolyline(
        [
          [0, 80],
          [0, 95],
        ],
        200,
        100,
      ),
    ).toBe('0,50 200,50');
  });
});

describe('slopePct', () => {
  it('is the gain over the distance, rounded (prototype formula)', () => {
    expect(slopePct(380, 4200)).toBe(9);
  });
  it('is 0 for a zero gain, not hidden', () => {
    expect(slopePct(0, 4200)).toBe(0);
  });
  it('is null when a value is missing or the distance is 0', () => {
    expect(slopePct(null, 4200)).toBeNull();
    expect(slopePct(10, null)).toBeNull();
    expect(slopePct(10, 0)).toBeNull();
    expect(slopePct(undefined, 4200)).toBeNull();
  });
});

describe('sampleProfile', () => {
  const profile = Array.from({ length: 300 }, (_, i) => [i * 10, 100 + i]);
  it('keeps 40 evenly spaced points of 300, first and last included, in order', () => {
    const sample = sampleProfile(profile, 40);
    expect(sample).toHaveLength(40);
    expect(sample[0]).toEqual([0, 100]);
    expect(sample.at(-1)).toEqual([2990, 399]);
    // index i of 40 maps to round(i × 299 / 39) of 300
    expect(sample[1]).toEqual(profile[8]);
    expect(sample[20]).toEqual(profile[153]);
    const ds = sample.map(([d]) => d as number);
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
  });
  it('returns a short profile unchanged', () => {
    const five = profile.slice(0, 5);
    expect(sampleProfile(five, 40)).toEqual(five);
  });
});
