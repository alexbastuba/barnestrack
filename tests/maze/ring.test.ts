import { describe, expect, it } from 'vitest';
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile } from '../../src/contracts/mazeMap.js';
import {
  DEFAULT_HOLE_COUNT,
  DEFAULT_RING_RATIO,
  holeAngleDeg,
  holeCentres,
  holeDiameterCm,
  holeRadiusPx,
  nearestHole,
  phaseForClick,
  pxPerCm,
  ringRadius,
  ringRotationForClick,
  targetClickOutcome,
} from '../../src/maze/ring.js';
import { distance } from '../../src/maze/types.js';

function map(overrides: Partial<MazeMapFile> = {}): MazeMapFile {
  return {
    schemaVersion: MAZE_MAP_SCHEMA_VERSION,
    referenceResolution: { width: 640, height: 480 },
    platform: { cx: 320, cy: 240, r: 200 },
    holes: { n: DEFAULT_HOLE_COUNT, ringRatio: DEFAULT_RING_RATIO, holeRadius_px: 11, phase_deg: 0 },
    target: { holeIndex: 7 },
    calibration: { platformDiameter_cm: 92 },
    createdFrom: 'vid_01',
    ...overrides,
  };
}

describe('holeCentres', () => {
  it('puts 20 holes evenly on the ring radius', () => {
    const m = map();
    const holes = holeCentres(m);
    expect(holes).toHaveLength(20);
    const radius = ringRadius(m.platform, m.holes);
    expect(radius).toBeCloseTo(178, 10);
    for (const hole of holes) {
      expect(distance(hole, { x: m.platform.cx, y: m.platform.cy })).toBeCloseTo(radius, 9);
      expect(hole.nudged).toBe(false);
    }
    for (let i = 1; i < holes.length; i++) {
      expect(holeAngleDeg(m.holes, i) - holeAngleDeg(m.holes, i - 1)).toBeCloseTo(18, 9);
    }
  });

  it('puts hole 0 at phase_deg and rotates the rest with it', () => {
    const m = map({
      holes: { n: 20, ringRatio: DEFAULT_RING_RATIO, holeRadius_px: 11, phase_deg: 9 },
    });
    const radius = ringRadius(m.platform, m.holes);
    const [hole0] = holeCentres(m);
    expect(hole0!.x).toBeCloseTo(320 + radius * Math.cos((9 * Math.PI) / 180), 9);
    expect(hole0!.y).toBeCloseTo(240 + radius * Math.sin((9 * Math.PI) / 180), 9);
    expect(holeAngleDeg(m.holes, 0)).toBeCloseTo(9, 9);
    expect(holeAngleDeg(m.holes, 10)).toBeCloseTo(189, 9);
    // Hole 19 wraps past 360 and comes back folded into [0, 360).
    expect(holeAngleDeg(m.holes, 19)).toBeCloseTo(351, 9);
  });

  it('applies per-hole offsets and flags only the holes that moved', () => {
    const m = map({
      holes: {
        n: 20,
        ringRatio: DEFAULT_RING_RATIO,
        holeRadius_px: 11,
        phase_deg: 0,
        offsets: [
          { holeIndex: 3, dx_px: 4, dy_px: -2 },
          { holeIndex: 5, dx_px: 0, dy_px: 0 },
        ],
      },
    });
    const holes = holeCentres(m);
    const plain = holeCentres(map());
    expect(holes[3]!.x - plain[3]!.x).toBeCloseTo(4, 9);
    expect(holes[3]!.y - plain[3]!.y).toBeCloseTo(-2, 9);
    expect(holes[3]!.nudged).toBe(true);
    expect(holes[5]!.nudged).toBe(false);
    expect(holes[4]!.x).toBeCloseTo(plain[4]!.x, 9);
  });
});

describe('nearestHole', () => {
  it('finds the hole a click landed on, offsets included', () => {
    const m = map({
      holes: {
        n: 20,
        ringRatio: DEFAULT_RING_RATIO,
        holeRadius_px: 11,
        phase_deg: 0,
        offsets: [{ holeIndex: 12, dx_px: 15, dy_px: 15 }],
      },
    });
    const hole12 = holeCentres(m)[12]!;
    const found = nearestHole(m, { x: hole12.x + 3, y: hole12.y - 2 });
    expect(found!.hole.holeIndex).toBe(12);
    expect(found!.distance_px).toBeCloseTo(Math.hypot(3, 2), 9);
  });
});

describe('phaseForClick', () => {
  it('slides the ring so the nearest hole lands exactly on the click', () => {
    const m = map({ holes: { n: 20, ringRatio: DEFAULT_RING_RATIO, holeRadius_px: 11, phase_deg: 0 } });
    const radius = ringRadius(m.platform, m.holes);
    const clickAngle = 57; // between hole 3 (54 deg) and hole 4 (72 deg), nearer hole 3
    const click = {
      x: 320 + radius * Math.cos((clickAngle * Math.PI) / 180),
      y: 240 + radius * Math.sin((clickAngle * Math.PI) / 180),
    };
    const phase = phaseForClick(m, click)!;
    expect(phase).toBeCloseTo(3, 9);

    const aligned = holeCentres({ ...m, holes: { ...m.holes, phase_deg: phase } });
    expect(distance(aligned[3]!, click)).toBeCloseTo(0, 6);
  });

  it('works when the click is nearer the hole across the 0-degree wrap', () => {
    const m = map({ holes: { n: 20, ringRatio: DEFAULT_RING_RATIO, holeRadius_px: 11, phase_deg: 355 } });
    const radius = ringRadius(m.platform, m.holes);
    const click = { x: 320 + radius * Math.cos((2 * Math.PI) / 180), y: 240 + radius * Math.sin((2 * Math.PI) / 180) };
    const phase = phaseForClick(m, click)!;
    const aligned = holeCentres({ ...m, holes: { ...m.holes, phase_deg: phase } });
    expect(distance(aligned[0]!, click)).toBeCloseTo(0, 6);
  });

  it('has no answer for a click exactly at the platform centre', () => {
    expect(phaseForClick(map(), { x: 320, y: 240 })).toBeNull();
  });
});

describe('calibration (D14, D44, O8)', () => {
  it('derives px/cm from the platform diameter and back again', () => {
    const scale = pxPerCm({ cx: 0, cy: 0, r: 200 }, 92)!;
    expect(scale).toBeCloseTo(400 / 92, 12);
    const radius = holeRadiusPx(5, scale);
    expect(radius).toBeCloseTo(2.5 * scale, 12);
    expect(holeDiameterCm(radius, scale)).toBeCloseTo(5, 12);
  });

  it('refuses to compute anything without a real diameter', () => {
    expect(pxPerCm({ cx: 0, cy: 0, r: 200 }, 0)).toBeNull();
    expect(pxPerCm({ cx: 0, cy: 0, r: 200 }, -92)).toBeNull();
    expect(pxPerCm({ cx: 0, cy: 0, r: 0 }, 92)).toBeNull();
  });
});

describe('ringRotationForClick', () => {
  it('is the turn that phaseForClick describes as an absolute angle', () => {
    const m = map({ holes: { n: 20, ringRatio: DEFAULT_RING_RATIO, holeRadius_px: 11, phase_deg: 4 } });
    const radius = ringRadius(m.platform, m.holes);
    const click = {
      x: 320 + radius * Math.cos((57 * Math.PI) / 180),
      y: 240 + radius * Math.sin((57 * Math.PI) / 180),
    };
    const turn = ringRotationForClick(m, click)!;
    const phase = phaseForClick(m, click)!;
    expect(m.holes.phase_deg + turn).toBeCloseTo(phase, 9);
    expect(Math.abs(turn)).toBeLessThanOrEqual(180);
  });

  it('takes the short way round the wrap', () => {
    const m = map({ holes: { n: 20, ringRatio: DEFAULT_RING_RATIO, holeRadius_px: 11, phase_deg: 358 } });
    const radius = ringRadius(m.platform, m.holes);
    const click = { x: 320 + radius * Math.cos((2 * Math.PI) / 180), y: 240 + radius * Math.sin((2 * Math.PI) / 180) };
    expect(ringRotationForClick(m, click)!).toBeCloseTo(4, 9);
  });

  it('has no answer at the platform centre', () => {
    expect(ringRotationForClick(map(), { x: 320, y: 240 })).toBeNull();
  });
});

describe('targetClickOutcome (D49)', () => {
  it('names the shared target the first time, when nothing has named one', () => {
    expect(targetClickOutcome(20, null, 13)).toEqual({ kind: 'set', holeIndex: 13 });
  });

  it('turns this video’s ring by whole holes once the target is named', () => {
    // Target 7, clicked 13: six holes of 18° each, so hole 7 lands on the click.
    expect(targetClickOutcome(20, 7, 13)).toEqual({ kind: 'turn', holes: 6, degrees: 108 });
    // And the other way round.
    expect(targetClickOutcome(20, 13, 7)).toEqual({ kind: 'turn', holes: -6, degrees: -108 });
  });

  it('turns by a multiple of one hole spacing, whatever the hole count', () => {
    for (const n of [12, 18, 20, 40]) {
      const outcome = targetClickOutcome(n, 2, 5);
      expect(outcome.kind).toBe('turn');
      if (outcome.kind !== 'turn') return;
      expect(outcome.degrees / (360 / n)).toBeCloseTo(3, 9);
    }
  });

  it('does nothing when the clicked hole already carries the target number', () => {
    expect(targetClickOutcome(20, 7, 7)).toEqual({ kind: 'unchanged' });
  });
});
