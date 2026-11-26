import { describe, expect, it } from 'vitest';
import { tileMosaic } from './osm';

describe('tileMosaic (the static map slide, plan §10 L3-8)', () => {
  it('takes the 2×2 zoom-14 tiles whose middle holds the start, and places the start dot on it', () => {
    // Chimbote: x 4618.47, y 8607.44 at zoom 14.
    const { tiles, x, y } = tileMosaic({ lat: -9.09, lng: -78.52 });
    expect(tiles).toEqual([
      'https://tile.openstreetmap.org/14/4617/8606.png',
      'https://tile.openstreetmap.org/14/4618/8606.png',
      'https://tile.openstreetmap.org/14/4617/8607.png',
      'https://tile.openstreetmap.org/14/4618/8607.png',
    ]);
    expect(x).toBeCloseTo(0.7338, 3);
    expect(y).toBeCloseTo(0.7212, 3);
  });

  it('keeps the start in the middle half of the mosaic on both sides of a tile centre', () => {
    // x 4618.47 (left of the tile centre) and 4618.53 (right of it); the same for y.
    for (const start of [
      { lat: -9.09, lng: -78.52 },
      { lat: -9.0935, lng: -78.5164 },
    ]) {
      const { x, y } = tileMosaic(start);
      for (const fraction of [x, y]) {
        expect(fraction).toBeGreaterThanOrEqual(0.25);
        expect(fraction).toBeLessThanOrEqual(0.75);
      }
    }
  });
});
