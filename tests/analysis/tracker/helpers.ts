/** Shared setup for the tracker tests: a clean scene, a background and a threshold from sample frames. */
import { pxPerCmFromPlatform, toPixelUnits } from '../../../src/analysis/tracker/calibration.js';
import { chooseThreshold, type ThresholdChoice } from '../../../src/analysis/tracker/foreground.js';
import { platformMask, type PlatformMask } from '../../../src/analysis/tracker/mask.js';
import {
  DEFAULT_TRACKING_PARAMETERS,
  type TrackingParameters,
} from '../../../src/analysis/tracker/params.js';
import {
  createTracker,
  type Tracker,
  type TrackerOptions,
} from '../../../src/analysis/tracker/tracker.js';
import {
  DEFAULT_MOUSE,
  DEFAULT_SCENE,
  PLATFORM_DIAMETER_CM,
  mouseOnCircle,
  renderScene,
  renderStaticScene,
  type SceneSpec,
} from '../synthetic-frames.js';

export interface Setup {
  spec: SceneSpec;
  params: TrackingParameters;
  pxPerCm: number;
  mask: PlatformMask;
  background: Uint8Array;
  threshold: ThresholdChoice;
  options: TrackerOptions;
}

/** Sample frames of a mouse running a circle, for the Otsu threshold. */
export function circleSamples(spec: SceneSpec, count = 12, noise = spec.noise): Uint8Array[] {
  const s = { ...spec, noise };
  const staticScene = renderStaticScene(s);
  const out: Uint8Array[] = [];
  for (let k = 0; k < count; k++) {
    const t = (k * 10) / count;
    const m = mouseOnCircle(s, t);
    out.push(
      renderScene(s, { mouse: { ...DEFAULT_MOUSE, ...m }, seed: 100 + k }, undefined, staticScene),
    );
  }
  return out;
}

export function setup(
  overrides: {
    spec?: Partial<SceneSpec>;
    params?: Partial<TrackingParameters>;
    threshold?: number;
  } = {},
): Setup {
  const spec: SceneSpec = { ...DEFAULT_SCENE, ...overrides.spec };
  const params: TrackingParameters = { ...DEFAULT_TRACKING_PARAMETERS, ...overrides.params };
  const pxPerCm = pxPerCmFromPlatform(spec.platform, PLATFORM_DIAMETER_CM);
  const px = toPixelUnits(params, spec.platform, pxPerCm);
  const mask = platformMask(spec.width, spec.height, spec.platform, px.maskRadius_px);
  const background = renderStaticScene({ ...spec, noise: 0 });
  const threshold: ThresholdChoice =
    overrides.threshold !== undefined
      ? { value: overrides.threshold, mode: 'manual' }
      : chooseThreshold(background, circleSamples(spec), mask, params);
  const options: TrackerOptions = {
    width: spec.width,
    height: spec.height,
    platform: spec.platform,
    pxPerCm,
    params,
    background,
    threshold,
  };
  return { spec, params, pxPerCm, mask, background, threshold, options };
}

export function trackerFor(s: Setup, extra: Partial<TrackerOptions> = {}): Tracker {
  return createTracker({ ...s.options, ...extra });
}

/** Nominal 30 fps timestamps. */
export function t_s(i: number): number {
  return i / 30;
}
