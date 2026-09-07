/**
 * The Review step's panels, built and tested unmounted (chunk 7a).
 *
 * Four self-contained components — parameters, events, metrics, quality — each
 * a `(container, props, callbacks) → { update, destroy }` factory over plain
 * DOM, with no globals, no session access and no video. The step that mounts
 * them owns the wiring: it re-runs `derive()` when `onParametersChange` fires,
 * moves the video when `onSeek` does, and turns `onOverride` / `onRevert` into
 * corrections.
 *
 * `prototypes/review-components/` is that wiring, done once, as a dev page.
 */
export { ANALYSIS_PARAMETER_BOUNDS, hasSlider } from './analysis-parameter-bounds.js';
export type { SliderParameterPath } from './analysis-parameter-bounds.js';

export { NO_CHANGE, describeDiff, describeEventCounts, eventDeltas } from './describe-diff.js';
export type { EventDelta } from './describe-diff.js';

export { createEventCard, eventSummary, flagsForEvent, shadowClauses } from './event-card.js';
export type { EventCardProps } from './event-card.js';

export { createEventList } from './event-list.js';
export type { EventListProps } from './event-list.js';

export { createMetricsCard, endingEscape, metricRows } from './metrics-card.js';
export type { MetricsCardProps } from './metrics-card.js';

export {
  CHANGE_DEBOUNCE_MS,
  createParametersPanel,
  editableParameterPaths,
  labelForPath,
  problemsByPath,
} from './parameters-panel.js';
export type { ParametersPanelCallbacks, ParametersPanelProps } from './parameters-panel.js';

export { createQualityPanel, figureDataFor } from './quality-panel.js';
export type { QualityPanelOptions, QualityPanelProps } from './quality-panel.js';

export { wholeClipStateFractions } from './quality-summary.js';

export { positionToFrame } from './types.js';
export type { AnnounceCallback, Component, SeekCallbacks, StrategyCallbacks } from './types.js';

export * from './format.js';
