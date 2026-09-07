/**
 * What every figure in `src/viz/` is: a pure draw function over the session's
 * internal representation, plus a text description of the same content for the
 * DOM table that mirrors the canvas (D37).
 *
 * No figure queries the DOM, reads a global, or touches video. Everything it
 * draws comes from its `FigureData` and its `FigureOpts`.
 */
import type { SessionFile } from '../contracts/session.js';

export type ThemeName = 'light' | 'print';

export interface FigureOpts {
  /**
   * Multiplier applied to the whole drawing. The canvas is sized
   * `width * scale` by `height * scale`; figures lay out in logical units and
   * let `beginFigure` apply the scale, so a 3× PNG is genuinely 3× resolution
   * rather than an upscaled 1× one (D32).
   */
  scale: number;
  theme: ThemeName;
  /** Logical figure size; each figure has a default. */
  width?: number;
  height?: number;
  /** A still from the video to draw the path over; a plain disc when absent. */
  background?: CanvasImageSource;
}

export interface FigureSize {
  width: number;
  height: number;
}

/**
 * The figure's content as text: what the Review step renders as a table beside
 * the canvas, so a screen reader and a grayscale reader get the same facts the
 * picture carries (D37).
 */
export interface FigureDescription {
  title: string;
  /** One sentence saying what the figure shows and in what units. */
  summary: string;
  columns: string[];
  rows: (string | number | null)[][];
}

/**
 * Which video a figure draws. Per-trial figures use `videoId`; cohort figures
 * (learning curve, group comparison) read the whole session and ignore it.
 */
/** Metrics a cohort figure can plot; the field names of `TrialMetrics`. */
export type PlottableMetric =
  | 'primaryLatency_s'
  | 'totalLatency_s'
  | 'primaryErrors'
  | 'totalErrors'
  | 'pathLength_cm'
  | 'meanSpeed_cmPerS'
  | 'targetQuadrantTime_s';

export interface FigureData {
  session: SessionFile;
  videoId: string;
  /** Which measure the cohort figures plot; primary latency by default. */
  metric?: PlottableMetric;
}

export interface FigureSpec {
  id: string;
  title: string;
  /** Whether the figure is about one trial or the whole cohort. */
  scope: 'trial' | 'cohort';
  defaultSize: FigureSize;
  /**
   * Why this figure cannot be drawn from this session, in words the user can
   * act on — or `null` when it can. A figure still draws that sentence on the
   * canvas rather than leaving an empty box.
   */
  unavailable(data: FigureData): string | null;
  draw(ctx: CanvasRenderingContext2D, data: FigureData, opts: FigureOpts): void;
  describe(data: FigureData): FigureDescription;
}
