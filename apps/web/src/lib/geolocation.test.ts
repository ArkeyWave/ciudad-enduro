import { describe, expect, it } from 'vitest';
import { geoReducer, IDLE, type GeoState } from './geolocation';

const fix = { lat: -9.07, lng: -78.59, accuracy: 8, at: 1 };
const active: GeoState = { status: 'active', fix };

describe('geoReducer (plan §10 L3-4)', () => {
  it('searches after a start, and is active with the first fix', () => {
    const searching = geoReducer(IDLE, { type: 'start' });
    expect(searching).toEqual({ status: 'searching', fix: null });
    expect(geoReducer(searching, { type: 'fix', fix })).toEqual(active);
  });

  it('is unavailable when the browser has no geolocation', () => {
    expect(geoReducer(IDLE, { type: 'unsupported' })).toEqual({ status: 'unavailable', fix: null });
  });

  it('is denied when the permission is refused, and drops the fix', () => {
    expect(geoReducer(active, { type: 'error', denied: true })).toEqual({ status: 'denied', fix: null });
  });

  it('keeps searching after a transient error, without the old fix', () => {
    expect(geoReducer(active, { type: 'error', denied: false })).toEqual({ status: 'searching', fix: null });
  });

  it('drops the fix of a hidden page, but an idle hook stays idle', () => {
    expect(geoReducer(active, { type: 'hidden' })).toEqual({ status: 'searching', fix: null });
    expect(geoReducer(IDLE, { type: 'hidden' })).toEqual(IDLE);
  });

  it('ignores a late fix after a denial', () => {
    expect(geoReducer({ status: 'denied', fix: null }, { type: 'fix', fix })).toEqual({ status: 'denied', fix: null });
  });
});
