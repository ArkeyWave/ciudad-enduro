import { describe, expect, it } from 'vitest';
import { profilePolyline } from './profile';

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
