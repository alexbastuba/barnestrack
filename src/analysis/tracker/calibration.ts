/**
 * Pixels per centimetre from the platform circle and its real diameter (D14,
 * D44), and the one place where every centimetre parameter of the tracker is
 * converted to pixels for one video.
 */
import type { ThresholdMode, TrackingParameters } from './params.js';

/** Platform circle in native video pixels (D15). */
export interface PlatformCircle {
  cx: number;
  cy: number;
  r: number;
}

export function pxPerCmFromPlatform(platform: PlatformCircle, platformDiameter_cm: number): number {
  if (!(platform.r > 0))
    throw new RangeError(`platform radius must be positive, got ${platform.r}`);
  if (!(platformDiameter_cm > 0)) {
    throw new RangeError(`platform diameter must be positive, got ${platformDiameter_cm} cm`);
  }
  return (2 * platform.r) / platformDiameter_cm;
}

export function cm2FromPx2(area_px2: number, pxPerCm: number): number {
  return area_px2 / (pxPerCm * pxPerCm);
}

export function px2FromCm2(area_cm2: number, pxPerCm: number): number {
  return area_cm2 * pxPerCm * pxPerCm;
}

/** `TrackingParameters` converted to pixels for one video. */
export interface TrackingParametersPx {
  pxPerCm: number;
  /** Platform radius plus the mask margin. */
  maskRadius_px: number;
  /** Pixels at least this far from the centre are in the rim-contact zone: within the rim margin of the platform edge, or beyond it. */
  rimZoneRadius_px: number;
  minBlobArea_px2: number;
  maxBlobArea_px2: number;
  expectedBlobArea_px2: number | null;
  oversizedBlobFactor: number;
  smallBlobFactor: number;
  tailOpeningRadius_px: number;
  noseCueWindowFrames: number;
  noseMovingSpeed_pxPerS: number;
  proximityRadius_px: number;
  fragmentMergeDistance_px: number;
  threshold: { mode: ThresholdMode; manualValue: number };
}

export function toPixelUnits(
  params: TrackingParameters,
  platform: PlatformCircle,
  pxPerCm: number,
): TrackingParametersPx {
  if (!(pxPerCm > 0)) throw new RangeError(`pxPerCm must be positive, got ${pxPerCm}`);
  const maskRadius_px = platform.r + params.platformMaskMargin_cm * pxPerCm;
  return {
    pxPerCm,
    maskRadius_px,
    rimZoneRadius_px: Math.max(0, platform.r - params.rimContactMargin_cm * pxPerCm),
    minBlobArea_px2: px2FromCm2(params.minBlobArea_cm2, pxPerCm),
    maxBlobArea_px2: px2FromCm2(params.maxBlobArea_cm2, pxPerCm),
    expectedBlobArea_px2:
      params.expectedBlobArea_cm2 === null
        ? null
        : px2FromCm2(params.expectedBlobArea_cm2, pxPerCm),
    oversizedBlobFactor: params.oversizedBlobFactor,
    smallBlobFactor: params.smallBlobFactor,
    tailOpeningRadius_px: params.tailOpeningRadius_cm * pxPerCm,
    noseCueWindowFrames: params.noseCueWindowFrames,
    noseMovingSpeed_pxPerS: params.noseMovingSpeed_cmPerS * pxPerCm,
    proximityRadius_px: params.proximityRadius_cm * pxPerCm,
    fragmentMergeDistance_px: params.fragmentMergeDistance_cm * pxPerCm,
    threshold: { mode: params.threshold.mode, manualValue: params.threshold.manualValue },
  };
}
