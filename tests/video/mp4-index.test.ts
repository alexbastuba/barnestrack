import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseAvcC } from '../../src/video/h264-poc.js';
import { parseMp4Index, type Mp4Index } from '../../src/video/mp4-index.js';
import {
  SKIP_REASON,
  encodeSyntheticClip,
  encodeSyntheticTieClip,
  ffmpegHasLibx264,
  ffprobePtsSeconds,
  type SyntheticClip,
} from './synthetic-clip.js';

const hasFfmpeg = ffmpegHasLibx264();
if (!hasFfmpeg) console.warn(SKIP_REASON);

const SAMPLE_DIR = process.env['BARNESTRACK_SAMPLE_DIR'];
if (!SAMPLE_DIR) {
  console.warn('BARNESTRACK_SAMPLE_DIR is not set; sample-video tests skipped');
}

/** Frame time must match ffprobe to the microsecond after both start at 0. */
const T_S_TOLERANCE_S = 1e-6;

function expectTimesMatchFixture(index: Mp4Index, fixturePts: number[]): void {
  expect(index.frameCount).toBe(fixturePts.length);
  const base = fixturePts[0] ?? 0;
  let maxError = 0;
  for (let i = 0; i < fixturePts.length; i++) {
    const error = Math.abs(index.frames[i]!.t_s - (fixturePts[i]! - base));
    if (error > maxError) maxError = error;
  }
  expect(maxError).toBeLessThanOrEqual(T_S_TOLERANCE_S);
}

function expectPresentationOrderInvariants(index: Mp4Index): void {
  index.frames.forEach((f, i) => expect(f.presIndex).toBe(i));
  const decodeIndices = new Set(index.frames.map((f) => f.decodeIndex));
  expect(decodeIndices.size).toBe(index.frameCount);
  for (let i = 1; i < index.frameCount; i++) {
    expect(index.frames[i]!.t_s).toBeGreaterThanOrEqual(index.frames[i - 1]!.t_s);
    expect(index.frames[i]!.cts).toBeGreaterThanOrEqual(index.frames[i - 1]!.cts);
  }
  expect(index.frames[0]!.t_s).toBe(0);
  expect(index.keyframePresIndices[0]).toBe(0);
}

/** With ties ordered by POC, (gop, poc) is strictly increasing along presentation order. */
function expectPocMonotone(index: Mp4Index): void {
  expect(index.tieBreak).toBe('poc');
  for (let i = 1; i < index.frameCount; i++) {
    const a = index.frames[i - 1]!;
    const b = index.frames[i]!;
    const increasing = a.gop! < b.gop! || (a.gop === b.gop && a.poc! < b.poc!);
    expect(increasing, `frames ${i - 1}→${i}: (${a.gop},${a.poc}) → (${b.gop},${b.poc})`).toBe(true);
  }
}

/** Tied pairs where the POC order differs from decode order (what the decoder would swap). */
function countTiesReorderedByPoc(index: Mp4Index): number {
  let n = 0;
  for (let i = 1; i < index.frameCount; i++) {
    const a = index.frames[i - 1]!;
    const b = index.frames[i]!;
    if (a.cts === b.cts && a.decodeIndex > b.decodeIndex) n++;
  }
  return n;
}

describe.skipIf(!hasFfmpeg)('parseMp4Index on a synthetic B-pyramid clip', () => {
  let clip: SyntheticClip;
  let index: Mp4Index;

  beforeAll(async () => {
    clip = encodeSyntheticClip();
    index = await parseMp4Index(clip.buffer);
  });
  afterAll(() => clip?.cleanup());

  it('finds 60 frames with a keyframe every 15', () => {
    expect(index.frameCount).toBe(60);
    expect(index.keyframePresIndices).toEqual([0, 15, 30, 45]);
    expect(index.width).toBe(64);
    expect(index.height).toBe(64);
    expect(index.codec).toMatch(/^avc1\./);
    expect(index.nominalFps).toBeCloseTo(30, 6);
    expect(index.durationSeconds).toBeCloseTo(2, 6);
    expect(index.warnings).toEqual([]);
  });

  it('separates decode order from presentation order', () => {
    const reordered = index.frames.filter((f) => f.decodeIndex !== f.presIndex);
    expect(reordered.length).toBeGreaterThan(0);
    expectPresentationOrderInvariants(index);
    expectPocMonotone(index);
  });

  it('rebases time on the edit list so the first frame is at t_s = 0', () => {
    expect(index.editOffsetTicks).toBeGreaterThan(0);
    expect(index.frames[0]!.cts).toBe(index.editOffsetTicks);
    expectTimesMatchFixture(index, ffprobePtsSeconds(clip.path));
  });

  it('reports no timebase anomalies for a clean clip and records the gap factor used', () => {
    expect(index.timebaseAnomalies).toEqual({
      duplicateTimestampPairs: 0,
      droppedFrameGaps: 0,
      dropGapFactor: 1.5,
      driftSeconds: expect.closeTo(0, 9),
      nominalTick: 512,
    });
  });

  it('counts dropped gaps with the caller-supplied factor', async () => {
    // Every 512-tick gap exceeds 0.5 × nominal, so all 59 gaps count.
    const strict = await parseMp4Index(clip.buffer, { dropGapFactor: 0.5 });
    expect(strict.timebaseAnomalies.droppedFrameGaps).toBe(59);
    expect(strict.timebaseAnomalies.dropGapFactor).toBe(0.5);
  });

  it('exposes an avcC description that parses as one SPS and one PPS', () => {
    const cfg = parseAvcC(index.description);
    expect(cfg.lengthSize).toBe(4);
    expect(cfg.sps.size).toBe(1);
    expect(cfg.pps.size).toBe(1);
    expect([...cfg.sps.values()][0]?.pocType).toBe(0);
  });

  it('rejects a buffer that is not an MP4 with a plain-language reason', async () => {
    await expect(parseMp4Index(new Uint8Array(4096).buffer)).rejects.toMatchObject({
      name: 'UnsupportedVideoError',
      reason: expect.stringMatching(/not a readable MP4|no movie header/),
    });
  });
});

describe.skipIf(!hasFfmpeg)('parseMp4Index on a synthetic clip with duplicate timestamps', () => {
  let clip: SyntheticClip;
  let byPoc: Mp4Index;
  let byDecodeOrder: Mp4Index;

  beforeAll(async () => {
    clip = encodeSyntheticTieClip();
    byPoc = await parseMp4Index(clip.buffer);
    byDecodeOrder = await parseMp4Index(clip.buffer, { tieBreak: 'decode_order' });
  });
  afterAll(() => clip?.cleanup());

  it('keeps every frame and counts the tied pairs', () => {
    expect(byPoc.frameCount).toBe(60);
    expect(byPoc.timebaseAnomalies.duplicateTimestampPairs).toBeGreaterThan(0);
    expectPresentationOrderInvariants(byPoc);
    expectTimesMatchFixture(byPoc, ffprobePtsSeconds(clip.path));
  });

  it('orders tied frames by picture order count, which decode order gets wrong', () => {
    expectPocMonotone(byPoc);
    expect(countTiesReorderedByPoc(byPoc)).toBeGreaterThan(0);
    expect(byDecodeOrder.tieBreak).toBe('decode_order');
    expect(byDecodeOrder.frames.map((f) => f.decodeIndex)).not.toEqual(
      byPoc.frames.map((f) => f.decodeIndex),
    );
    // Both rules agree everywhere except inside tied pairs.
    for (let i = 0; i < 60; i++) {
      const a = byPoc.frames[i]!;
      const b = byDecodeOrder.frames[i]!;
      expect(a.cts).toBe(b.cts);
      expect(a.t_s).toBe(b.t_s);
    }
  });
});

interface SampleExpectation {
  name: string;
  frameCount: number;
  duplicateTimestampPairs: number;
  droppedFrameGaps: number;
  driftSeconds: number;
  tiesReorderedByPoc: number;
}

const SAMPLES: SampleExpectation[] = [
  { name: 'test50', frameCount: 5539, duplicateTimestampPairs: 162, droppedFrameGaps: 214, driftSeconds: 0.4333, tiesReorderedByPoc: 68 },
  { name: 'test51', frameCount: 741, duplicateTimestampPairs: 17, droppedFrameGaps: 23, driftSeconds: -0.0667, tiesReorderedByPoc: 7 },
  { name: 'test53', frameCount: 905, duplicateTimestampPairs: 25, droppedFrameGaps: 34, driftSeconds: 0.0667, tiesReorderedByPoc: 5 },
];

describe.skipIf(!SAMPLE_DIR)('parseMp4Index on the sample videos (BARNESTRACK_SAMPLE_DIR)', () => {
  for (const sample of SAMPLES) {
    describe(sample.name, () => {
      let index: Mp4Index;
      let fixture: number[];

      beforeAll(async () => {
        const bytes = readFileSync(join(SAMPLE_DIR!, `${sample.name}.mp4`));
        index = await parseMp4Index(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        );
        fixture = JSON.parse(
          readFileSync(new URL(`../fixtures/${sample.name}.pts.json`, import.meta.url), 'utf-8'),
        ) as number[];
      });

      it(`has ${sample.frameCount} frames in a consistent presentation order`, () => {
        expect(index.frameCount).toBe(sample.frameCount);
        expect(index.codec).toBe('avc1.640020');
        expectPresentationOrderInvariants(index);
        expectPocMonotone(index);
      });

      it('matches the ffprobe timestamps within 1 µs', () => {
        expectTimesMatchFixture(index, fixture);
      });

      it('measures the timebase anomalies', () => {
        expect(index.timebaseAnomalies.duplicateTimestampPairs).toBe(sample.duplicateTimestampPairs);
        expect(index.timebaseAnomalies.droppedFrameGaps).toBe(sample.droppedFrameGaps);
        expect(index.timebaseAnomalies.dropGapFactor).toBe(1.5);
        expect(index.warnings).toEqual([]);
        expect(index.timebaseAnomalies.driftSeconds).toBeCloseTo(sample.driftSeconds, 3);
        expect(index.editOffsetTicks).toBeGreaterThan(0);
      });

      it('orders the tied pairs the decoder would otherwise swap', () => {
        expect(countTiesReorderedByPoc(index)).toBe(sample.tiesReorderedByPoc);
      });
    });
  }
});
