/**
 * The range each analysis parameter's slider spans, and why.
 *
 * This is the counterpart of `TRACKING_PARAMETER_BOUNDS` in
 * `src/analysis/tracker/params.ts` for the parameters `derive()` consumes, and
 * it borrows that table's shape and its `clampToBound` rather than inventing a
 * second one.
 *
 * One difference matters. A tracking bound is authoritative: a value outside it
 * is clamped and the clamped value is what the pass runs with. These bounds are
 * *the slider's* range only. The numeric field beside each slider accepts
 * anything `validateParameters` accepts, so a lab that wants a 600 s cutoff can
 * type one; the slider simply stops at the end of the range a Barnes maze
 * plausibly needs. That is why `min`/`max` here are never used to reject input
 * — only to lay out the track — and why every entry still carries its reason:
 * a number that shapes what the user can reach by dragging is still a number
 * someone has to be able to argue with.
 *
 * `gapFilling.enabled` and `trialCensoring.censorToCutoff` are absent because
 * they are checkboxes, not sliders; the type says so, so neither can be
 * forgotten by accident.
 */
import type { AnalysisParameterPath } from '../../analysis/parameters.js';
import type { ParameterBound } from '../../analysis/tracker/params.js';

export type SliderParameterPath = Exclude<
  AnalysisParameterPath,
  'gapFilling.enabled' | 'trialCensoring.censorToCutoff'
>;

/**
 * Keyed by every numeric analysis parameter. `Record` rather than a partial
 * map on purpose: adding a parameter without a slider range fails `tsc` here
 * instead of rendering a control with no track.
 */
export const ANALYSIS_PARAMETER_BOUNDS: Record<SliderParameterPath, ParameterBound> = {
  'holeInvestigation.radiusFactor': {
    min: 0.5,
    max: 4,
    step: '0.1',
    reason:
      'Below half a hole radius the event point would have to be almost exactly on the centre; past 4 the discs of neighbouring holes on a 20-hole ring overlap and a bout counts at two holes at once.',
  },
  'holeInvestigation.minDuration_s': {
    min: 0,
    max: 10,
    step: '0.05',
    reason:
      'Zero counts a single frame passing over a hole; ten seconds is longer than most complete investigations in the sample clips.',
  },
  'holeInvestigation.mergeGap_s': {
    min: 0,
    max: 10,
    step: '0.05',
    reason:
      'Zero merges nothing, so every re-entry is a separate event; past ten seconds a genuine return visit would be folded into the first one.',
  },
  'escapeEntry.radiusFactor': {
    min: 0.5,
    max: 3,
    step: '0.1',
    reason:
      'An entry is judged at the target hole itself, so the useful range is tighter than an investigation radius: past 3 a loss half a platform away would qualify.',
  },
  'escapeEntry.minDuration_s': {
    min: 0,
    max: 20,
    step: '0.1',
    reason:
      'Zero would make every dropped frame at the target an entry; twenty seconds is well past the point where an animal in the box has stopped being detected.',
  },
  'escapeEntry.persistCutoff_s': {
    min: 0,
    max: 60,
    step: '0.5',
    reason:
      'This decides when the trial ends. Zero ends it at the first flicker; a minute is longer than any escape latency the cutoff would leave room for.',
  },
  trialCutoff_s: {
    min: 10,
    max: 600,
    step: '5',
    reason:
      'Barnes protocols run from about 90 s to 300 s; the range reaches either side of that without offering a cutoff shorter than a single traverse of the platform.',
  },
  'targetQuadrant.holeSpan': {
    min: 0.5,
    max: 10,
    step: '0.5',
    reason:
      'Half a hole either side is the narrowest sector that still contains the target; ten holes either side of a 20-hole ring is the whole platform, where the measure stops discriminating.',
  },
  kinematicsSmoothingWindowFrames: {
    min: 1,
    max: 31,
    step: '2',
    reason:
      'The filter needs an odd width, so the step is 2 and the track lands only on legal values. One disables smoothing; 31 frames is a second of video, by which point real movement is being filtered away.',
  },
  'gapFilling.maxDuration_s': {
    min: 0,
    max: 2,
    step: '0.05',
    reason:
      'Gap filling is meant for a dropped frame or two (O10). Past two seconds an interpolated straight line is a claim about behaviour, not a repair.',
  },
  'kinematics.speedWindowFrames': {
    min: 1,
    max: 30,
    step: '1',
    reason:
      'One frame either side is the shortest centred window; a second of video either side smooths a mouse-scale speed profile flat.',
  },
  'kinematics.duplicateTimestampFactor': {
    min: 0,
    max: 0.95,
    step: '0.05',
    reason:
      'A fraction of the nominal frame interval, and it must stay below `dropGapFactor`, which is above 1. Stopping at 0.95 keeps the slider inside the range the validator accepts.',
  },
  'kinematics.dropGapFactor': {
    min: 1.05,
    max: 5,
    step: '0.05',
    reason:
      'Must exceed 1 or every ordinary frame interval is a dropped-frame gap; past 5 a genuine four-frame drop goes unreported.',
  },
  noseConfidenceCutoff: {
    min: 0,
    max: 1,
    step: '0.05',
    reason: 'A confidence, so the range is the whole of it (O16).',
  },
  outlierVelocityThreshold_cmPerS: {
    min: 10,
    max: 500,
    step: '5',
    reason:
      'A mouse does not sustain a metre a second; below 10 cm/s ordinary walking would be marked an outlier, and 500 is far past any real movement, where the rule stops firing at all.',
  },
  'strategy.spatialMaxErrors': {
    min: 0,
    max: 10,
    step: '1',
    reason:
      'Zero makes spatial mean a faultless first approach and nothing else; past ten errors a trial that visited half the ring would still be called spatial, which is the case the rule exists to exclude (O7).',
  },
  'strategy.spatialMaxHoleDistance': {
    min: 1,
    max: 10,
    step: '1',
    reason:
      'One hole either side is the tightest neighbourhood that still admits an error; ten holes is half a 20-hole ring, where the constraint excludes nothing (O7).',
  },
  'strategy.spatialMaxCentreCrossings': {
    min: 0,
    max: 5,
    step: '1',
    reason:
      'Zero forbids any return through the centre before the target, which is the strictest reading of a direct approach; past five the count no longer separates a spatial search from a random one (O7).',
  },
  'strategy.serialMinRun': {
    min: 2,
    max: 10,
    step: '1',
    reason:
      'Two adjacent holes in a row is a coincidence rather than a strategy, so that is the floor; ten consecutive adjacent holes is half the ring and almost no trial would qualify (O7).',
  },
  'strategy.centreZoneRadiusFraction': {
    min: 0.1,
    max: 0.9,
    step: '0.05',
    reason:
      'Below a tenth of the platform radius the centre zone is smaller than the animal and is never entered; past 0.9 it reaches the hole ring and every move between two holes counts as a centre crossing (O7).',
  },
  'quality.goodMinPositionedFraction': {
    min: 0.5,
    max: 1,
    step: '0.01',
    reason:
      'Below half the trial positioned, GOOD would claim more than the track supports; at 1 a single dropped frame denies a video the tier, so GOOD becomes unreachable (D30).',
  },
  'quality.poorMaxPositionedFraction': {
    min: 0,
    max: 1,
    step: '0.01',
    reason:
      'Zero means no video is ever POOR; the top of the range is the whole of it because the constraint that matters — staying at or below the GOOD threshold — is enforced by `validateParameters`, not by the track (D30).',
  },
};

/** Whether a parameter path has a slider — i.e. is numeric rather than a switch. */
export function hasSlider(path: string): path is SliderParameterPath {
  return path in ANALYSIS_PARAMETER_BOUNDS;
}
