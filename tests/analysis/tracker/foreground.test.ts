import { describe, expect, it } from 'vitest';
import {
  accumulateDiffHistogram,
  binarizeForeground,
  chooseThreshold,
  otsuSplit,
  otsuThreshold,
} from '../../../src/analysis/tracker/foreground.js';
import { DEFAULT_MOUSE, DEFAULT_SCENE, renderScene } from '../synthetic-frames.js';
import { circleSamples, setup } from './helpers.js';

describe('otsu', () => {
  it('splits a bimodal histogram between the modes', () => {
    const h = new Uint32Array(256);
    for (let v = 0; v < 8; v++) h[v] = 10000;
    for (let v = 100; v < 140; v++) h[v] = 50;
    const t = otsuSplit(h);
    expect(t).toBeGreaterThanOrEqual(7);
    expect(t).toBeLessThan(100);
    expect(otsuThreshold(h)).toBe(t + 1);
  });

  it('is 0 for an empty or single-valued histogram', () => {
    expect(otsuSplit(new Uint32Array(256))).toBe(0);
    const h = new Uint32Array(256);
    h[42] = 100;
    expect(otsuSplit(h)).toBe(0);
    expect(otsuThreshold(h)).toBe(1);
  });
});

describe('chooseThreshold and binarizeForeground', () => {
  it('picks a threshold from the samples that isolates the mouse', () => {
    const s = setup();
    expect(s.threshold.mode).toBe('otsu');
    expect(s.threshold.value).toBeGreaterThan(20);
    expect(s.threshold.value).toBeLessThan(140);

    const mouse = { ...DEFAULT_MOUSE, x: 300, y: 200, heading: 0.3 };
    const frame = renderScene(s.spec, { mouse });
    const diff = new Uint8Array(frame.length);
    const fg = new Uint8Array(frame.length);
    const extent = binarizeForeground(s.background, frame, s.mask, s.threshold.value, diff, fg);
    const expectedBody = Math.PI * mouse.bodyLength * mouse.bodyWidth;
    expect(extent.count).toBeGreaterThan(expectedBody * 0.9);
    expect(extent.count).toBeLessThan(expectedBody * 1.6); // body + tail
    // Every foreground pixel lies within reach of the mouse (body + tail).
    const reach = mouse.bodyLength + mouse.tailLength + 6;
    for (let y = 0; y < s.spec.height; y++) {
      for (let x = 0; x < s.spec.width; x++) {
        if (fg[y * s.spec.width + x]) {
          expect(Math.hypot(x - mouse.x, y - mouse.y)).toBeLessThan(reach);
        }
      }
    }
    expect(extent.bbox.x0).toBeGreaterThanOrEqual(mouse.x - reach);
    expect(extent.bbox.x1).toBeLessThanOrEqual(mouse.x + reach);
  });

  it('reports no foreground on an empty platform and outside the mask', () => {
    const s = setup();
    const frame = renderScene(s.spec, {});
    const diff = new Uint8Array(frame.length);
    const fg = new Uint8Array(frame.length);
    expect(binarizeForeground(s.background, frame, s.mask, s.threshold.value, diff, fg).count).toBe(
      0,
    );
    // A dark object outside the platform is invisible to the tracker.
    const outside = renderScene(s.spec, { hand: { x: 30, y: 30, radius: 20, darkness: 30 } });
    expect(
      binarizeForeground(s.background, outside, s.mask, s.threshold.value, diff, fg).count,
    ).toBe(0);
  });

  it('uses the manual value in manual mode and rejects an impossible one', () => {
    const s = setup({ params: { threshold: { mode: 'manual', manualValue: 77 } } });
    expect(s.threshold).toEqual({ value: 77, mode: 'manual' });
    expect(() =>
      chooseThreshold(s.background, [], s.mask, {
        ...s.params,
        threshold: { mode: 'manual', manualValue: 0 },
      }),
    ).toThrow(/1–255/);
  });

  it('accumulates exactly one histogram entry per masked pixel per frame', () => {
    const s = setup();
    const h = new Uint32Array(256);
    const samples = circleSamples(s.spec, 3);
    for (const f of samples) accumulateDiffHistogram(s.background, f, s.mask, h);
    expect(h.reduce((a, b) => a + b, 0)).toBe(3 * s.mask.pixelCount);
  });
});

describe('DEFAULT_SCENE sanity', () => {
  it('has the platform inside the frame', () => {
    const p = DEFAULT_SCENE.platform;
    expect(p.cx - p.r).toBeGreaterThan(0);
    expect(p.cy + p.r).toBeLessThan(DEFAULT_SCENE.height);
  });
});
