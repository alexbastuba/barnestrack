/**
 * Frame ranges as a person types them. This is the only way to act on the
 * background contamination warning, which says in so many words "exclude its
 * frames with backgroundExcludeRanges" — so a typo must say what is wrong
 * rather than quietly excluding nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  describeFrameRanges,
  formatFrameRanges,
  parseFrameRanges,
} from '../../src/ui/frame-ranges.js';

describe('parseFrameRanges', () => {
  it('reads the shape the placeholder shows', () => {
    expect(parseFrameRanges('0-74, 200-210')).toEqual({
      ok: true,
      ranges: [
        { startFrame: 0, endFrame: 74 },
        { startFrame: 200, endFrame: 210 },
      ],
    });
  });

  it('treats an empty field as no exclusions', () => {
    expect(parseFrameRanges('')).toEqual({ ok: true, ranges: [] });
    expect(parseFrameRanges('   ')).toEqual({ ok: true, ranges: [] });
  });

  it('accepts a bare number as a single frame', () => {
    expect(parseFrameRanges('412')).toEqual({
      ok: true,
      ranges: [{ startFrame: 412, endFrame: 412 }],
    });
  });

  it('forgives the separators and spacing people actually type', () => {
    const expected = [
      { startFrame: 0, endFrame: 74 },
      { startFrame: 200, endFrame: 210 },
    ];
    expect(parseFrameRanges('0-74;200-210')).toEqual({ ok: true, ranges: expected });
    expect(parseFrameRanges(' 0 - 74 ,  200 .. 210 ')).toEqual({ ok: true, ranges: expected });
    expect(parseFrameRanges('0–74, 200–210')).toEqual({ ok: true, ranges: expected });
    expect(parseFrameRanges('0-74, , 200-210,')).toEqual({ ok: true, ranges: expected });
  });

  it('normalises a backwards range and sorts, so the same set hashes alike (D51)', () => {
    expect(parseFrameRanges('74-0')).toEqual({
      ok: true,
      ranges: [{ startFrame: 0, endFrame: 74 }],
    });
    expect(parseFrameRanges('200-210, 0-74')).toEqual(parseFrameRanges('0-74, 200-210'));
  });

  // D51: two spellings of the same excluded frames must be one parameter set,
  // or two runs that sampled identical frames disagree about their hash.
  it('merges overlapping ranges, so the same frames spell one way', () => {
    expect(parseFrameRanges('5-8, 0-10')).toEqual(parseFrameRanges('0-10'));
    expect(parseFrameRanges('0-10, 0-10')).toEqual(parseFrameRanges('0-10'));
    expect(parseFrameRanges('0-10, 5-20')).toEqual(parseFrameRanges('0-20'));
  });

  it('merges ranges that merely touch, which exclude the same frames', () => {
    expect(parseFrameRanges('0-10, 11-20')).toEqual(parseFrameRanges('0-20'));
    expect(parseFrameRanges('0-10, 12-20')).toEqual({
      ok: true,
      ranges: [
        { startFrame: 0, endFrame: 10 },
        { startFrame: 12, endFrame: 20 },
      ],
    });
  });

  it('leaves genuinely separate ranges separate', () => {
    const parsed = parseFrameRanges('0-74, 200-210');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatFrameRanges(parsed.ranges)).toBe('0-74, 200-210');
  });

  it('names the piece it could not read instead of dropping it', () => {
    const result = parseFrameRanges('0-74, banana');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('"banana"');
    expect(result.message).toContain('0-74');
  });

  it('rejects a negative or fractional frame rather than rounding it', () => {
    expect(parseFrameRanges('-5-10').ok).toBe(false);
    expect(parseFrameRanges('1.5-10').ok).toBe(false);
  });
});

describe('formatFrameRanges', () => {
  it('round-trips through the parser', () => {
    const text = '0-74, 200-210';
    const parsed = parseFrameRanges(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(formatFrameRanges(parsed.ranges)).toBe(text);
  });

  it('writes no ranges as an empty field', () => {
    expect(formatFrameRanges([])).toBe('');
  });
});

describe('describeFrameRanges', () => {
  it('says what excluding nothing means, rather than saying nothing', () => {
    expect(describeFrameRanges([])).toBe('none — every frame may be sampled');
  });

  it('counts the frames, inclusive of both ends', () => {
    expect(describeFrameRanges([{ startFrame: 0, endFrame: 74 }])).toBe(
      '1 range, 75 frames excluded',
    );
    expect(
      describeFrameRanges([
        { startFrame: 0, endFrame: 74 },
        { startFrame: 200, endFrame: 209 },
      ]),
    ).toBe('2 ranges, 85 frames excluded');
  });
});
