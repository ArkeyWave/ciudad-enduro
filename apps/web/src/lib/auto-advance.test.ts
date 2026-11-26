import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_ADVANCE_MS, autoAdvance } from './auto-advance';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('autoAdvance (plan §10.1 A14)', () => {
  it('moves once, 3 s after the card centre enters the band', () => {
    const advance = vi.fn();
    const slider = autoAdvance(advance);
    slider.band(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
    expect(AUTO_ADVANCE_MS).toBe(3000);
  });

  it('never loops: leaving and entering the band again after the move does nothing', () => {
    const advance = vi.fn();
    const slider = autoAdvance(advance);
    slider.band(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS);
    slider.band(false);
    slider.band(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 3);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('does not move when the card leaves the band before 3 s; a new entry starts a new 3 s', () => {
    const advance = vi.fn();
    const slider = autoAdvance(advance);
    slider.band(true);
    vi.advanceTimersByTime(2000);
    slider.band(false);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
    expect(advance).not.toHaveBeenCalled();
    slider.band(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1);
    expect(advance).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('a second "inside" report does not restart the 3 s', () => {
    const advance = vi.fn();
    const slider = autoAdvance(advance);
    slider.band(true);
    vi.advanceTimersByTime(2000);
    slider.band(true);
    vi.advanceTimersByTime(1000);
    expect(advance).toHaveBeenCalledTimes(1);
  });

  it('stops for good on a rider input, inside the band or before it', () => {
    const during = vi.fn();
    const inside = autoAdvance(during);
    inside.band(true);
    vi.advanceTimersByTime(1000);
    inside.stop();
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
    inside.band(false);
    inside.band(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
    expect(during).not.toHaveBeenCalled();

    const before = vi.fn();
    const outside = autoAdvance(before);
    outside.stop();
    outside.band(true);
    vi.advanceTimersByTime(AUTO_ADVANCE_MS * 2);
    expect(before).not.toHaveBeenCalled();
  });
});
