/**
 * The Review panels' number formatting. Pure strings, so this runs in the
 * default node environment like the rest of the analysis-facing tests.
 *
 * The point of every case here is the same one: a value that does not exist
 * must not come out looking like a measured zero.
 */
import { describe, expect, it } from 'vitest';
import {
  NOT_RECORDED,
  formatBoolean,
  formatChange,
  formatCm,
  formatCount,
  formatDelta,
  formatHole,
  formatNumber,
  formatParameterValue,
  formatSeconds,
  formatSpeed,
  formatTimeAndFrame,
  pluralise,
} from '../../../src/ui/components/format.js';

describe('the not-computable convention', () => {
  it('writes null, undefined and NaN as an em dash, never as zero', () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatNumber(value)).toBe(NOT_RECORDED);
      expect(formatSeconds(value)).toBe(NOT_RECORDED);
      expect(formatCm(value)).toBe(NOT_RECORDED);
      expect(formatSpeed(value)).toBe(NOT_RECORDED);
      expect(formatCount(value)).toBe(NOT_RECORDED);
    }
  });

  it('keeps a real zero, which is a measurement and not an absence', () => {
    expect(formatSeconds(0)).toBe('0.00 s');
    expect(formatCount(0)).toBe('0');
    expect(formatNumber(0)).toBe('0.00');
  });
});

describe('units', () => {
  it('names the unit with the number so a bare figure is never shown', () => {
    expect(formatSeconds(12.345)).toBe('12.35 s');
    expect(formatCm(184.204)).toBe('184.20 cm');
    expect(formatSpeed(6.3149)).toBe('6.31 cm/s');
  });

  it('separates thousands in a frame or event count', () => {
    expect(formatCount(5539)).toBe('5,539');
  });
});

describe('formatTimeAndFrame', () => {
  it('gives the clock a person reads and the frame the app seeks on', () => {
    expect(formatTimeAndFrame(92.4, 2481)).toBe('1:32 (frame 2,481)');
  });

  it('drops the frame clause when there is no frame, rather than inventing one', () => {
    expect(formatTimeAndFrame(92.4, null)).toBe('1:32');
    expect(formatTimeAndFrame(null, null)).toBe(NOT_RECORDED);
  });
});

describe('formatHole', () => {
  it('says which hole, and says so plainly when there is none', () => {
    expect(formatHole(7)).toBe('hole 7');
    expect(formatHole(0)).toBe('hole 0');
    expect(formatHole(null)).toBe('no hole');
  });
});

describe('formatParameterValue', () => {
  it('writes a boolean as on/off, the way the parameter sheet does', () => {
    expect(formatParameterValue(true)).toBe('on');
    expect(formatParameterValue(false)).toBe('off');
  });

  it('explains a null expected body area instead of showing an empty cell', () => {
    expect(formatParameterValue(null)).toBe(NOT_RECORDED);
  });

  it('describes the threshold mode rather than printing JSON', () => {
    expect(formatParameterValue({ mode: 'otsu', manualValue: 40 })).toBe(
      'otsu (chosen from the video)',
    );
    expect(formatParameterValue({ mode: 'manual', manualValue: 40 })).toBe('manual 40');
  });

  it('writes frame ranges as ranges, and an empty list as "none"', () => {
    expect(formatParameterValue([])).toBe('none');
    expect(
      formatParameterValue([
        { startFrame: 0, endFrame: 74 },
        { startFrame: 200, endFrame: 210 },
      ]),
    ).toBe('0–74, 200–210');
  });

  it('keeps a number at its own precision, so 1.5 does not become 1.50', () => {
    expect(formatParameterValue(1.5)).toBe('1.5');
    expect(formatParameterValue(180)).toBe('180');
  });
});

describe('diff helpers', () => {
  it('uses a real minus sign for a decrease', () => {
    expect(formatDelta(2)).toBe('+2');
    expect(formatDelta(-1)).toBe('−1');
    expect(formatDelta(0)).toBe('0');
  });

  it('writes a change as before → after', () => {
    expect(formatChange('4', '3')).toBe('4 → 3');
  });
});

describe('pluralise', () => {
  it('agrees with the count, including for an irregular plural', () => {
    expect(pluralise(1, 'investigation')).toBe('1 investigation');
    expect(pluralise(14, 'investigation')).toBe('14 investigations');
    expect(pluralise(0, 'investigation')).toBe('0 investigations');
    expect(pluralise(1, 'escape entry', 'escape entries')).toBe('1 escape entry');
    expect(pluralise(2, 'escape entry', 'escape entries')).toBe('2 escape entries');
  });
});

describe('formatBoolean', () => {
  it('answers in words, so the value survives grayscale and a screen reader', () => {
    expect(formatBoolean(true)).toBe('yes');
    expect(formatBoolean(false)).toBe('no');
  });
});
