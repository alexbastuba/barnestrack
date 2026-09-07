/**
 * The figure registry (D32). The Review step and the gallery page both iterate
 * this list rather than naming figures one by one, so a new figure appears in
 * both by being added here.
 */
import { groupComparisonFigure } from './group-comparison.js';
import { heatmapFigure } from './heatmap.js';
import { holeRasterFigure } from './hole-raster.js';
import { learningCurveFigure } from './learning-curve.js';
import { quadrantOverlayFigure } from './quadrant-overlay.js';
import { qualityStripFigure } from './quality-strip.js';
import { speedColoredPathFigure } from './speed-colored-path.js';
import { timeColoredPathFigure } from './time-colored-path.js';
import { trajectoryFigure } from './trajectory.js';
import type { FigureSpec } from './types.js';

export const FIGURES: readonly FigureSpec[] = [
  trajectoryFigure,
  timeColoredPathFigure,
  speedColoredPathFigure,
  heatmapFigure,
  holeRasterFigure,
  quadrantOverlayFigure,
  qualityStripFigure,
  learningCurveFigure,
  groupComparisonFigure,
];

export function figureById(id: string): FigureSpec | undefined {
  return FIGURES.find((figure) => figure.id === id);
}

export { groupComparison, groupComparisonFigure } from './group-comparison.js';
export { CELL_CM_RANGE, DEFAULT_CELL_CM, cellSizeCm, heatmapFigure, occupancyGrid } from './heatmap.js';
export { holeRasterFigure, rasterGeometry } from './hole-raster.js';
export { learningCurveFigure, learningCurveSeries } from './learning-curve.js';
export { quadrantOverlayFigure } from './quadrant-overlay.js';
export { qualityStripFigure, stateRuns } from './quality-strip.js';
export { speedColoredPathFigure } from './speed-colored-path.js';
export { timeColoredPathFigure } from './time-colored-path.js';
export { trajectoryFigure } from './trajectory.js';

export { DEFAULT_METRIC, METRIC_LABELS, NO_METADATA_MESSAGE } from './cohort.js';
export {
  CIVIDIS,
  COLORMAP_NAMES,
  COLORMAPS,
  colormapByName,
  luminanceMonotone,
  sampleColormap,
  VIRIDIS,
} from './colormaps.js';
export type { Colormap, ColormapName } from './colormaps.js';
export { analysedTrials, centroidPath, isAnalysed, trialLabel, trialSource } from './data.js';
export type { AnalysedVideo, TrialSource } from './data.js';
export { figurePngName, renderFigureToPng } from './figure-export.js';
export { paletteFor, seriesColour } from './theme.js';
export type { Palette } from './theme.js';
export type {
  FigureData,
  FigureDescription,
  FigureOptions,
  FigureOpts,
  FigureSize,
  FigureSpec,
  PlottableMetric,
  ThemeName,
} from './types.js';
