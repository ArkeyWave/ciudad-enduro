import { describe, expect, it } from 'vitest';
import { formatDistance, formatDrop, formatGrade, gradeDeg, profilePolyline, sampleProfile, shownDrop } from './profile';

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

describe('formatDistance', () => {
  it('is in metres under 1 km and in kilometres from 1 km', () => {
    expect(formatDistance(715.4)).toBe('715 m');
    expect(formatDistance(999)).toBe('999 m');
    expect(formatDistance(1000)).toBe('1 km');
    expect(formatDistance(4200)).toBe('4.2 km');
  });
});

describe('shownDrop', () => {
  it('is the loss, negative, for a Descenso', () => {
    expect(shownDrop('descenso', 0, 30)).toBe(-30);
  });
  it('is the gain for every other type', () => {
    expect(shownDrop('enduro', 380, 410)).toBe(380);
  });
  it('is null when the value it needs is missing', () => {
    expect(shownDrop('descenso', 30, null)).toBeNull();
    expect(shownDrop('enduro', undefined, 30)).toBeNull();
  });
});

describe('gradeDeg', () => {
  it('is atan(|drop| / distance) in degrees, for a climb and a descent', () => {
    expect(gradeDeg(380, 4200)).toBeCloseTo(5.17, 2);
    expect(gradeDeg(-30, 715)).toBeCloseTo(2.4, 2);
  });
  it('is 0 for a zero drop, not hidden', () => {
    expect(gradeDeg(0, 4200)).toBe(0);
  });
  it('is null when a value is missing or the distance is 0', () => {
    expect(gradeDeg(null, 4200)).toBeNull();
    expect(gradeDeg(10, null)).toBeNull();
    expect(gradeDeg(10, 0)).toBeNull();
  });
});

describe('formatDrop and formatGrade', () => {
  it('writes a descent with a minus sign and the grade with one decimal', () => {
    expect(formatDrop(-30)).toBe('−30 m');
    expect(formatDrop(380)).toBe('380 m');
    expect(formatGrade(5.17)).toBe('5.2°');
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
