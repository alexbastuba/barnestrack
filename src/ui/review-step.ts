// Adapted from talmolab/vibes/event-annotator (BSD-3-Clause, commit d9410fa)
// Copyright (c) 2025, Talmo Lab at the Salk Institute.
/**
 * Step 4 — Review. The frame view with the automatic and corrected points,
 * the timeline (D24), every correction (D25) as a pure operation over the
 * corrections layer with a live recompute of the whole analysis (D20, D22),
 * the DOM mirrors of what the canvases draw (D37), and chunk 7a's four panels
 * mounted in the four boxes below (D19 · F3).
 *
 * Nothing here patches an output: a correction writes one entry into the
 * corrections layer, the store notifies, and the derived analysis is
 * recomputed from `auto ⊕ corrections` and re-rendered — the same functions
 * that produce the exports (D55). Automatic and corrected values are told
 * apart by shape and word, never colour alone (D26).
 *
 * Borrowed from event-annotator (D38): painting a range with two keystrokes —
 * one at its first frame, one at its last — for the not-visible range and the
 * added event; re-implemented here, no code copied.
 *
 * `#review-parameters`, `#review-metrics`, `#review-events` and
 * `#review-quality` hold chunk 7a's components. They are built once and driven
 * with `update()` on every recompute — never torn down and remounted, or a
 * slider drag and the focused card are lost every time the debounce fires
 * (`prototypes/review-components/RESULTS.md`). The 12-column events table that
 * used to live in `#review-events` is still here as `#review-events-mirror`,
 * beside the other two mirrors: the event cards are not a table, and D37 wants
 * a table with D26's source column.
 */
import type { DerivedAnalysis } from '../analysis/derive.js';
import { nearestHoleIndex } from '../analysis/geometry.js';
import type { EventRecord } from '../contracts/events.js';
import type { Parameters } from '../contracts/parameters.js';
import type { CorrectionEntry, CorrectionsLayer, VideoDescriptor } from '../contracts/session.js';
import type { NamedPointId, TrackFrame } from '../contracts/track.js';
import { holeCentres, ringRadius } from '../maze/ring.js';
import { transformMap } from '../maze/similarity.js';
import type { Point } from '../maze/types.js';
import { videoToViewport, type ViewTransform } from '../maze/view-transform.js';
import {
  analyseAllVideos,
  analyseMissing,
  analyseVideo,
  analysisBlockedReason,
  type AnalysisRun,
} from '../session/analyse.js';
import {
  addEvent,
  confirmEvent,
  deleteEvent,
  describeCorrection,
  editEvent,
  markRange,
  noEscapeCorrection,
  orphanedCorrections,
  pointCorrectionAt,
  NO_CORRECTIONS,
  revertCorrection,
  revertEvent,
  revertNoEscape,
  revertTrialStart,
  setNoEscape,
  setPoint,
  setStrategyOverride,
  setTrialStart,
  strategyOverride,
  type CorrectionMeta,
} from '../session/corrections.js';
import type { VideoId } from '../session/stored.js';
import { CanvasView } from './canvas-view.js';
import {
  createEventList,
  createMetricsCard,
  createParametersPanel,
  createQualityPanel,
  describeDiff,
  flagLabel,
  flagsForEvent,
  formatClock,
  formatHole,
  formatSeconds,
  positionToFrame,
  type Component,
  type EventListProps,
  type MetricsCardProps,
  type ParametersPanelProps,
  type QualityPanelProps,
  type SeekCallbacks,
  type StrategyCallbacks,
} from './components/index.js';
import { button, disclosure, el, replaceChildren, uniqueId, type Child } from './dom.js';
import {
  ACCENT,
  INK_SOFT,
  drawCentroidMarker,
  drawCrosshair,
  drawHole,
  drawLabel,
  drawNoseMarker,
} from './overlay-draw.js';
import { formatFrameTime } from './review-format.js';
import { createReviewExport, type ReviewExport } from './review-export.js';
import {
  createReviewFigures,
  type ReviewFigures,
  type ReviewFiguresProps,
} from './review-figures.js';
import { keyLegend, resolveKey, type ReviewAction } from './review-keys.js';
import { describeQueue, eventsToCheck, isConfirmed, stepQueue } from './review-queue.js';
import { Scrubber } from './scrubber.js';
import { stateRuns } from '../viz/quality-strip.js';
import { ZOOM_STEP, frameAtTime } from './timeline-geometry.js';
import {
  eventAtFrame,
  flaggedRuns,
  nextSpan,
  timelineModel,
  unlikelyEventIds,
  type TimelineModel,
} from './timeline-model.js';
import { Timeline, type EventEdge } from './timeline.js';
import type { AppContext, Step } from './step.js';

type PointTool = 'off' | NamedPointId;
type Painting = { kind: 'not_visible' | 'add_event'; startFrame: number } | null;

const NUDGE_PX = 1;
const NUDGE_PX_LARGE = 10;
/** Frames either side of the playhead in the frames table. */
const FRAME_TABLE_RADIUS = 7;

function newMeta(): CorrectionMeta {
  const uuid =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  return { id: uuid, timestamp: new Date().toISOString() };
}

const STATE_WORDS: Record<TrackFrame['detectionState'], string> = {
  tracked: 'tracked',
  not_detected: 'not detected',
  ambiguous: 'ambiguous',
  low_confidence: 'low confidence',
};

const KIND_WORDS: Record<EventRecord['kind'], string> = {
  investigation: 'investigation',
  escape_entry: 'escape entry',
  tracking_failure: 'tracking failure',
};

export function createReviewStep(context: AppContext): Step {
  const { store } = context;

  // ---- state ------------------------------------------------------------------

  let selectedVideoId: VideoId | null = null;
  let analysis: DerivedAnalysis | null = null;
  let model: TimelineModel | null = null;
  let cacheKey: {
    videoId: VideoId;
    auto: unknown;
    corrections: unknown;
    parameters: unknown;
    mazeMap: unknown;
    transform: unknown;
  } | null = null;
  let lastTiming: { deriveMs: number; totalMs: number } | null = null;
  let playhead = 0;
  let tool: PointTool = 'off';
  let selectedEventId: string | null = null;
  let selectedEdge: EventEdge | null = null;
  let painting: Painting = null;
  let hoverPoint: Point | null = null;
  let hoverText: string | null = null;
  let seekToken = 0;
  let deriving = false;
  let playing: { raf: number; wallStart: number; timeStart: number } | null = null;
  let lastEpoch = store.epoch;
  let lastVideoId: VideoId | null = null;
  let lastTimebaseSource: unknown = null;
  /**
   * The analysis each video had immediately before its current one, which is
   * what the diff badge compares against (D20). Written in `ensureAnalysis` on
   * a cache miss, so a threshold change, a correction and a re-derive all get a
   * true "before", and an idle re-render does not silently reset it.
   */
  const previousByVideo = new Map<VideoId, DerivedAnalysis>();
  /** Queue length per video, filled whenever a video's full analysis is derived. */
  const queueCounts = new Map<VideoId, number>();
  /** A cohort sweep's result for the video on screen, handed to the next `ensureAnalysis`. */
  let adopted: { videoId: VideoId; run: AnalysisRun } | null = null;
  /** True while a cohort sweep is writing derived caches; one render follows, not one per video. */
  let sweeping = false;
  /** Videos whose derive threw, and why, so the sweep stops retrying them silently. */
  const failedAnalyses = new Map<VideoId, string>();
  /** The maze map and parameters those failures were recorded against. */
  let failedInputs: { mazeMap: unknown; parameters: unknown } | null = null;

  const body = el('div', { class: 'review-step' });

  // ---- derived state -----------------------------------------------------------

  function currentVideo(): VideoDescriptor | null {
    const videos = store.videos;
    const chosen = videos.find((v) => v.id === selectedVideoId);
    if (chosen) return chosen;
    return videos.find((v) => store.analysisFor(v.id) !== undefined) ?? videos[0] ?? null;
  }

  function currentLayer(): CorrectionsLayer | null {
    const video = currentVideo();
    return video ? (store.analysisFor(video.id)?.corrections ?? null) : null;
  }

  function frameCount(): number {
    return analysis?.cleanedTrack.length ?? 0;
  }

  function videoMap() {
    const video = currentVideo();
    const map = store.current.mazeMap;
    if (!video || !map) return null;
    return transformMap(map, video.mazeTransform, video.referenceResolution);
  }

  /** Re-derives when the automatic layer, the corrections, the parameters or the maze changed identity. */
  function ensureAnalysis(): void {
    const video = currentVideo();
    const entry = video ? store.analysisFor(video.id) : undefined;
    const mazeMap = store.current.mazeMap;
    if (!video || !entry || !mazeMap) {
      analysis = null;
      model = null;
      cacheKey = null;
      return;
    }
    const parameters = store.parameters;
    if (
      cacheKey &&
      cacheKey.videoId === video.id &&
      cacheKey.auto === entry.auto &&
      cacheKey.corrections === entry.corrections &&
      cacheKey.parameters === parameters &&
      cacheKey.mazeMap === mazeMap &&
      cacheKey.transform === video.mazeTransform
    ) {
      return;
    }
    deriving = true;
    try {
      const started = performance.now();
      // A cohort sweep has already derived this video; taking its result rather
      // than deriving a second time is the difference between three derives and
      // four on every threshold change.
      const run = adopted?.videoId === video.id ? adopted.run : analyseVideo(store, video.id);
      adopted = null;
      if (!run) {
        analysis = null;
        model = null;
        cacheKey = null;
        return;
      }
      if (analysis && cacheKey?.videoId === video.id) previousByVideo.set(video.id, analysis);
      analysis = run.analysis;
      model = timelineModel(analysis, entry.corrections);
      // Counted here, where the flags exist, so the selector can name a number
      // for every video this session has actually derived.
      queueCounts.set(video.id, eventsToCheck(analysis.events, analysis.reviewFlags, model.stateRuns).length);
      lastTiming = { deriveMs: run.deriveMs, totalMs: performance.now() - started };
      cacheKey = {
        videoId: video.id,
        auto: entry.auto,
        corrections: entry.corrections,
        parameters: store.parameters,
        mazeMap,
        transform: video.mazeTransform,
      };
      if (playhead >= frameCount()) playhead = Math.max(0, frameCount() - 1);
    } catch (error) {
      analysis = null;
      model = null;
      cacheKey = null;
      console.error('BarnesTrack: the analysis could not be computed', error);
      context.announce(`The analysis could not be computed: ${(error as Error).message}`);
    } finally {
      deriving = false;
    }
  }

  // ---- corrections: the one write path -----------------------------------------------

  function commit(next: CorrectionsLayer, message: string): void {
    const video = currentVideo();
    if (!video) return;
    const started = performance.now();
    store.setCorrections(video.id, next); // notifies → refresh → re-derive → re-render
    const total = performance.now() - started;
    const timing = lastTiming ? ` Recomputed in ${lastTiming.deriveMs.toFixed(1)} ms (${total.toFixed(0)} ms with the redraw).` : '';
    context.announce(`${message}.${timing}`);
  }

  function layerOrNull(): CorrectionsLayer | null {
    const layer = currentLayer();
    if (!layer || !analysis) {
      context.announce('Nothing to correct: this video has no analysis yet.');
      return null;
    }
    return layer;
  }

  function placePoint(point: NamedPointId, x: number, y: number): void {
    const layer = layerOrNull();
    if (!layer) return;
    commit(
      setPoint(layer, playhead, point, { x, y, confidence: 1, valid: true }, newMeta()),
      `${point === 'nose' ? 'Nose' : 'Centroid'} placed by hand on frame ${playhead}`,
    );
  }

  function nudgePoint(dx: number, dy: number): void {
    if (tool === 'off' || !analysis) return;
    const frame = analysis.cleanedTrack[playhead];
    if (!frame) return;
    const current = tool === 'nose' ? frame.nose : frame.centroid;
    const other = tool === 'nose' ? frame.centroid : frame.nose;
    const existing = currentLayer() ? pointCorrectionAt(currentLayer()!, playhead, tool) : null;
    if (existing?.value.valid) {
      placePoint(tool, existing.value.x + dx, existing.value.y + dy);
    } else if (current.valid) {
      placePoint(tool, current.x + dx, current.y + dy);
    } else {
      // Nothing to nudge: seed the point from the keyboard at the frame's other point, or at
      // the platform centre, and say so — the arrows then walk it into place.
      const seed = other.valid ? other : { x: analysis.geometry.platform.cx, y: analysis.geometry.platform.cy };
      const from = other.valid ? `the ${tool === 'nose' ? 'centroid' : 'nose'}` : 'the platform centre';
      placePoint(tool, seed.x + dx, seed.y + dy);
      context.announce(
        `The ${tool} was not positioned on frame ${playhead}, so it was placed at ${from}: keep nudging it into place, or click the frame.`,
      );
    }
  }

  function markInvalid(): void {
    if (tool === 'off') return;
    const layer = layerOrNull();
    if (!layer) return;
    commit(
      setPoint(layer, playhead, tool, { x: 0, y: 0, confidence: 0, valid: false }, newMeta()),
      `${tool === 'nose' ? 'Nose' : 'Centroid'} marked invalid on frame ${playhead}`,
    );
  }

  function paintNotVisible(): void {
    const layer = layerOrNull();
    if (!layer) return;
    if (painting?.kind === 'not_visible') {
      const from = painting.startFrame;
      painting = null;
      commit(markRange(layer, 'not_visible', from, playhead, newMeta()), `Animal marked not visible, frames ${Math.min(from, playhead)}–${Math.max(from, playhead)}`);
    } else {
      painting = { kind: 'not_visible', startFrame: playhead };
      context.announce(`Not visible from frame ${playhead}: move to the last frame of the stretch and press V again, or Escape to cancel.`);
      renderStatus();
    }
  }

  function markEscapeBox(): void {
    const layer = layerOrNull();
    if (!layer) return;
    commit(
      markRange(layer, 'in_escape_box', playhead, frameCount() - 1, newMeta()),
      `Animal marked in the escape box from frame ${playhead} to the end of the video`,
    );
  }

  function addEventHere(): void {
    const layer = layerOrNull();
    if (!layer || !analysis) return;
    if (painting?.kind === 'add_event') {
      const from = painting.startFrame;
      painting = null;
      const end = playhead;
      const hole = holeForFrame(end);
      const next = addEvent(layer, hole, from, end, newMeta());
      selectedEventId = `user-${next.entries[next.entries.length - 1]!.id}`;
      selectedEdge = null;
      commit(next, `Investigation added at hole ${hole}, frames ${Math.min(from, end)}–${Math.max(from, end)}; change the hole with H if it is wrong`);
    } else {
      painting = { kind: 'add_event', startFrame: playhead };
      context.announce(`New investigation from frame ${playhead}: move to its last frame and press A again, or Escape to cancel.`);
      renderStatus();
    }
  }

  /** The hole nearest the event point at a frame, or the hole select's value, or the target. */
  function holeForFrame(frame: number): number {
    if (analysis) {
      const f = analysis.cleanedTrack[frame];
      const p = f?.nose.valid ? f.nose : f?.centroid.valid ? f.centroid : null;
      if (p) return nearestHoleIndex(analysis.geometry, p.x, p.y);
      return analysis.geometry.targetIndex;
    }
    return Number(holeSelect.value) || 0;
  }

  function selectedEvent(): EventRecord | null {
    if (!analysis || selectedEventId === null) return null;
    return analysis.events.find((e) => e.id === selectedEventId) ?? null;
  }

  // ---- the review queue ----------------------------------------------------------------

  /** The events still wanting a human on the video on screen. */
  function queue(): string[] {
    if (!analysis || !model) return [];
    return eventsToCheck(analysis.events, analysis.reviewFlags, model.stateRuns);
  }

  /**
   * How many events want a human on a video, for the video selector.
   *
   * Review flags come from a full derive, which the step runs for the video on
   * screen; the cohort cache holds only the derived layer. So a video this
   * session has opened is counted with its flags, and one it has not is counted
   * from its uncertain frames alone — a lower bound that corrects itself the
   * moment the user selects it. Deriving all of them for a dropdown label would
   * cost a cohort sweep per keystroke.
   */
  function queueCountFor(videoId: VideoId): number | null {
    const cached = queueCounts.get(videoId);
    if (cached !== undefined) return cached;
    const derived = store.analysisFor(videoId)?.derived;
    if (!derived) return null;
    return eventsToCheck(derived.events, [], stateRuns(derived.cleanedTrack)).length;
  }

  function videoOptionLabel(video: { id: VideoId; filename: string }): string {
    const count = queueCountFor(video.id);
    if (count === null) return `${video.filename} (not tracked)`;
    return `${video.filename} — ${describeQueue(count)}`;
  }

  /** Selects a queued event, seeks to it and brings its card into view. */
  function goToQueued(direction: 1 | -1): void {
    const ids = queue();
    const next = stepQueue(ids, selectedEventId, direction);
    if (next === null || !analysis) {
      context.announce('Nothing to check on this video.');
      return;
    }
    // Nothing is scrolled: the user is looking at the video, and the strip
    // under it now says which event this is. Scrolling the event card into
    // view took the page away from the frame the decision is made on.
    selectQueued(next, true);
  }

  /**
   * Selects a queued event by id, seeks to it and — unless the caller has
   * already said something — announces where it sits in the queue.
   *
   * The announcement is the position alone. The strip is a live region and has
   * just said which event this is; saying it again here in different words made
   * one keypress two utterances for a screen-reader user. `keepSelected` passes
   * `false` for the same reason: its own commit message has just been spoken.
   */
  function selectQueued(eventId: string, announce: boolean): void {
    const ids = queue();
    const ev = analysis?.events.find((candidate) => candidate.id === eventId);
    if (!ev) return;
    selectedEventId = ev.id;
    selectedEdge = null;
    timeline.setSelection(ev.id, null);
    seek(positionOfFrame(ev.startFrame), false);
    renderEventsTable();
    renderQueue();
    if (announce) context.announce(`${ids.indexOf(ev.id) + 1} of ${ids.length} to check.`);
  }

  /**
   * Why an event is in the queue, in the words the event card uses: its review
   * flags, or — with none — the uncertain frames that put it there
   * (`eventsToCheck`). An event nobody has questioned gets no clause at all.
   */
  function queueReason(ev: EventRecord): string | null {
    const flags = analysis ? flagsForEvent(analysis.reviewFlags, ev.id) : [];
    if (flags.length > 0) {
      return flags.map((flag) => `${flagLabel(flag.code)} — ${flag.message}`).join(' · ');
    }
    if (queue().includes(ev.id)) return 'decided over frames the tracker was unsure of';
    return null;
  }

  /** The one line under the video: which event is selected, and what to do with it. */
  function describeCurrentEvent(ev: EventRecord): string {
    const parts = [
      KIND_WORDS[ev.kind].charAt(0).toUpperCase() + KIND_WORDS[ev.kind].slice(1),
      formatHole(ev.holeIndex),
      `${formatClock(ev.startTime_s)}–${formatClock(ev.endTime_s)}`,
      formatSeconds(ev.durationSeconds),
    ];
    const reason = queueReason(ev);
    if (reason) parts.push(`flagged: ${reason}`);
    if (ev.source === 'corrected') parts.push(isConfirmed(ev) ? 'user · confirmed, no change' : 'corrected by hand');
    return parts.join(' · ');
  }

  function renderQueue(): void {
    const count = queue().length;
    queueCount.textContent = describeQueue(count);
    queuePrevious.disabled = count === 0;
    queueNext.disabled = count === 0;

    const ev = selectedEvent();
    // Investigations only: see `keepSelected`.
    keepButton.disabled = ev === null || analysis === null || ev.kind !== 'investigation';
    keepButton.title =
      ev !== null && ev.kind !== 'investigation'
        ? `This ${KIND_WORDS[ev.kind]} cannot be kept: confirming it would recompute the distances it was judged on.`
        : '';
    const line = ev
      ? describeCurrentEvent(ev)
      : `${describeQueue(count)} — press ] or click an event on the timeline`;
    // Only when it actually changed: the strip is a polite live region, and
    // `textContent =` replaces the text node even with an identical string, so
    // an unguarded write re-announces the whole line on every re-derive — and
    // `render()` runs on every correction and every debounced threshold commit.
    if (line !== currentEventLine.textContent) currentEventLine.textContent = line;
    currentEventHint.hidden = ev === null;
  }

  function relabelSelected(holeIndex: number): void {
    const layer = layerOrNull();
    const ev = selectedEvent();
    if (!layer || !ev) {
      context.announce('Select an event first (click a bar on the timeline, or press E).');
      return;
    }
    if (ev.kind !== 'investigation') {
      context.announce('Only an investigation can be moved to another hole.');
      return;
    }
    if (ev.holeIndex === holeIndex) return;
    commit(
      editEvent(layer, ev.id, { holeIndex, startFrame: ev.startFrame, endFrame: ev.endFrame }, newMeta()),
      `Event moved from hole ${ev.holeIndex} to hole ${holeIndex}`,
    );
  }

  function retimeSelected(edge: EventEdge, frame: number): void {
    const layer = layerOrNull();
    const ev = selectedEvent();
    if (!layer || !ev) return;
    const start = edge === 'start' ? frame : ev.startFrame;
    const end = edge === 'end' ? frame : ev.endFrame;
    if (start > end) {
      context.announce('An event cannot end before it starts.');
      return;
    }
    commit(
      editEvent(layer, ev.id, { holeIndex: ev.holeIndex ?? undefined, startFrame: start, endFrame: end }, newMeta()),
      `Event ${ev.id} ${edge} moved to frame ${frame}`,
    );
  }

  /**
   * "Keep": the user has looked at this event and it is right. It is recorded
   * as a correction whose values are the automatic ones — the only way to say
   * "confirmed" over the D9 contract, which has no such flag — so the event
   * becomes the user's, leaves the queue, and can be reverted like any other
   * correction. The selection then advances to the next queued event, the same
   * as `]`, so a run of good events is a run of single keystrokes.
   */
  function keepSelected(): void {
    const layer = layerOrNull();
    const ev = selectedEvent();
    if (!layer || !ev) {
      context.announce('Select an event first (click a bar on the timeline, or press E).');
      return;
    }
    if (ev.kind !== 'investigation') {
      // The confirmation is an edit, and an edit is re-measured over its span.
      // On an escape entry or a tracking failure — spans that are mostly
      // unpositioned — that re-measurement does not reproduce the automatic
      // `point_used` and distances, so "confirmed, no change" would be a lie in
      // `events.csv`. Refused until the engine can carry those through
      // (docs/known-limitations.md).
      context.announce(
        `Only an investigation can be kept as it is. Keeping this ${KIND_WORDS[ev.kind]} would recompute the point and the distances it was judged on, so the exported numbers would change under a note saying they had not.`,
      );
      return;
    }
    // Taken *before* the commit: afterwards this event is no longer in the
    // queue, and `stepQueue` would restart at the head rather than move on.
    const following = stepQueue(queue(), ev.id, 1);
    commit(
      confirmEvent(layer, ev.id, { holeIndex: ev.holeIndex, startFrame: ev.startFrame, endFrame: ev.endFrame }, newMeta()),
      `Event ${ev.id} kept as it is: confirmed by the user, no change`,
    );
    if (following === null || following === ev.id) {
      selectedEventId = null;
      selectedEdge = null;
      timeline.setSelection(null, null);
      renderEventsTable();
      renderQueue();
      context.announce('Kept. Nothing left to check on this video.');
      return;
    }
    selectQueued(following, false);
  }

  function deleteSelected(): void {
    const layer = layerOrNull();
    const ev = selectedEvent();
    if (!layer || !ev) {
      context.announce('Select an event first (click a bar on the timeline, or press E).');
      return;
    }
    selectedEventId = null;
    selectedEdge = null;
    commit(deleteEvent(layer, ev.id, newMeta()), `Event ${ev.id} deleted`);
  }

  function trialStartHere(): void {
    const layer = layerOrNull();
    if (!layer) return;
    commit(setTrialStart(layer, playhead, newMeta()), `Trial start set to frame ${playhead}`);
  }

  // ---- playback -----------------------------------------------------------------------

  function stopPlaying(announce: boolean): void {
    if (!playing) return;
    cancelAnimationFrame(playing.raf);
    playing = null;
    if (announce) context.announce(`Paused at frame ${playhead}.`);
    renderStatus();
  }

  function togglePlay(): void {
    if (playing) {
      stopPlaying(true);
      return;
    }
    if (!model) return;
    const times = model.frameTimes;
    const last = times.length - 1;
    if (playhead >= last) seek(0, false);
    playing = { raf: 0, wallStart: performance.now(), timeStart: times[playhead] ?? 0 };
    context.announce('Playing at normal speed. Space pauses.');
    const tick = (): void => {
      if (!playing || !model) return;
      const elapsed = (performance.now() - playing.wallStart) / 1000;
      const target = frameAtTime(model.frameTimes, playing.timeStart + elapsed);
      if (target !== playhead) seek(target, false);
      if (target >= last) {
        stopPlaying(false);
        context.announce('Reached the end of the video.');
        return;
      }
      playing.raf = requestAnimationFrame(tick);
    };
    playing.raf = requestAnimationFrame(tick);
    renderStatus();
  }

  // ---- frame view -----------------------------------------------------------------------

  function paint(ctx: CanvasRenderingContext2D, view: ViewTransform): void {
    const map = videoMap();
    const at = (p: Point): Point => videoToViewport(p, view);
    const current = eventAtFrame(model?.events ?? [], playhead);
    if (map) {
      const centre = at({ x: map.platform.cx, y: map.platform.cy });
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, map.platform.r * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = INK_SOFT;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, ringRadius(map.platform, map.holes) * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      const holeRadius = Math.max(map.holes.holeRadius_px * view.zoom, 3);
      for (const hole of holeCentres(map)) {
        drawHole(ctx, at(hole), holeRadius, hole.holeIndex, {
          isTarget: hole.holeIndex === map.target.holeIndex,
          selected: current?.holeIndex === hole.holeIndex,
          sized: map.holes.holeRadius_px > 0,
          emphasised: current?.holeIndex === hole.holeIndex,
        });
      }
    }
    const frame = analysis?.cleanedTrack[playhead];
    if (frame) {
      if (frame.centroid.valid) drawCentroidMarker(ctx, at(frame.centroid), frame.centroid.source);
      if (frame.nose.valid) drawNoseMarker(ctx, at(frame.nose), frame.nose.source, `nose ${frame.noseHeadingConfidence.toFixed(2)}`);
      const lines = [`frame ${playhead} · ${frame.t_s.toFixed(3)} s · ${STATE_WORDS[frame.detectionState]} (${frame.reason})`];
      if (!frame.centroid.valid) lines.push('centroid: not positioned');
      if (!frame.nose.valid) lines.push('nose: not available');
      if (analysis?.trial.startFrame === playhead) lines.push('trial start');
      if (current) lines.push(`${KIND_WORDS[current.kind]} ${current.label}${current.corrected ? ' · user' : ''}`);
      lines.forEach((line, i) => drawLabel(ctx, line, 8, 8 + i * 18, i === 0));
    }
    if (tool !== 'off' && hoverPoint) drawCrosshair(ctx, at(hoverPoint), `place the ${tool} here`);
  }

  const canvasView = new CanvasView({
    label:
      'Video frame with the maze, the centroid and the nose. A filled marker is automatic; a diamond with a "user" badge was placed by hand; a hollow dashed marker was filled by the cleaning step. The tables below repeat everything drawn here.',
    paint,
    onPick: (point) => {
      if (tool === 'off') return;
      placePoint(tool, point.x, point.y);
    },
    onHover: (p) => {
      hoverPoint = p;
      if (tool !== 'off') canvasView.requestDraw();
    },
    announce: context.announce,
  });

  async function showFrame(frameIndex: number): Promise<void> {
    const video = currentVideo();
    const attachment = video ? store.attachmentFor(video.id) : undefined;
    if (!attachment) {
      canvasView.setFrame(null);
      return;
    }
    const token = ++seekToken;
    try {
      const bitmap = await attachment.frameSource.getFrame(frameIndex);
      if (token !== seekToken) return;
      canvasView.setVideoSize(attachment.index.width, attachment.index.height);
      canvasView.setFrame(bitmap);
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      context.announce(`Frame ${frameIndex} could not be shown: ${(error as Error).message}`);
    }
  }

  const scrubber = new Scrubber({
    onSeek: (frameIndex) => onPlayhead(frameIndex),
    announce: context.announce,
  });
  // `F` puts the caret in the frame field; Enter or Escape hands the keyboard back to the
  // timeline so the single-key actions work again without reaching for the mouse.
  scrubber.frameField.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return;
    event.preventDefault();
    if (event.key === 'Enter') scrubber.seek(Number(scrubber.frameField.value), true);
    timeline.surface.focus();
  });

  function seek(frame: number, announce: boolean): void {
    scrubber.seek(frame, announce);
  }

  function onPlayhead(frame: number): void {
    playhead = frame;
    timeline.setPlayhead(frame);
    void showFrame(frame);
    canvasView.requestDraw();
    renderFrameTable();
    renderStatus();
  }

  // ---- timeline ------------------------------------------------------------------------

  const timeline = new Timeline({
    onSeek: (frame) => seek(frame, false),
    onSelectEvent: (id) => {
      selectedEventId = id;
      selectedEdge = null;
      timeline.setSelection(id, null);
      renderEventsTable();
      renderQueue();
      renderStatus();
    },
    onRetime: (eventId, edge, frame) => {
      selectedEventId = eventId;
      retimeSelected(edge, frame);
    },
    onTrialStart: (frame) => {
      const layer = layerOrNull();
      if (!layer) return;
      commit(setTrialStart(layer, frame, newMeta()), `Trial start moved to frame ${frame}`);
    },
    onHover: (text) => {
      hoverText = text;
      renderStatus();
    },
    announce: context.announce,
  });

  // ---- toolbar ---------------------------------------------------------------------------

  const noseButton = button('Nose (N)', () => setTool('nose'), { attrs: { 'aria-pressed': 'false' } });
  const centroidButton = button('Centroid (C)', () => setTool('centroid'), { attrs: { 'aria-pressed': 'false' } });
  const toolOffButton = button('Off (Esc)', () => setTool('off'));
  const invalidButton = button('Mark invalid (X)', () => markInvalid());
  const notVisibleButton = button('Not visible from here… (V)', () => paintNotVisible());
  const escapeBoxButton = button('Entered the escape box here — ends the trial (B)', () => markEscapeBox());
  const escapeBoxHint = el('span', {
    id: uniqueId('review-escape-hint'),
    class: 'hint',
    text: 'The trial ends at this frame and total latency is stamped here, so place it on the frame the animal was last seen going in.',
  });
  escapeBoxButton.setAttribute('aria-describedby', escapeBoxHint.id);
  const addEventButton = button('Add investigation from here… (A)', () => addEventHere());
  const deleteEventButton = button('Delete event (Delete)', () => deleteSelected());
  const holeSelect = el('select', { id: uniqueId('review-hole'), attrs: { 'aria-label': 'Hole of the selected event' } });
  holeSelect.addEventListener('change', () => relabelSelected(Number(holeSelect.value)));
  const edgeStartButton = button('Start edge (S)', () => selectEdge('start'), { attrs: { 'aria-pressed': 'false' } });
  const edgeEndButton = button('End edge (D)', () => selectEdge('end'), { attrs: { 'aria-pressed': 'false' } });
  const trialStartButton = button('Set trial start here (T)', () => trialStartHere());
  const revertTrialStartButton = button('Revert trial start', () => {
    const layer = layerOrNull();
    if (!layer) return;
    commit(revertTrialStart(layer), 'Trial start reverted to automatic');
  });
  /*
   * D63: "the animal never entered the escape box", asserted by a person.
   *
   * A trial with no escape entry is `review` by construction, and this is the only thing that can
   * clear it, so it is deliberately harder to tick than a button is to press: the reason is
   * required, and the box refuses to stay ticked without one — the same bargain the strategy
   * override strikes, for the same reason (an assertion with no reason is a silent disagreement
   * with the tool). It is disabled outright while the trial already has an escape entry: there is
   * nothing to confirm, and the hint names the time so the user can go and look.
   */
  const noEscapeBox = el('input', { id: uniqueId('review-no-escape') });
  noEscapeBox.type = 'checkbox';
  const noEscapeReason = el('input', { id: uniqueId('review-no-escape-reason'), class: 'text-input' });
  noEscapeReason.type = 'text';
  noEscapeReason.placeholder = 'Why, in your own words';
  const noEscapeHint = el('span', { id: uniqueId('review-no-escape-hint'), class: 'hint' });
  const noEscapeProblem = el('p', { class: 'error', attrs: { role: 'alert', hidden: true } });
  noEscapeProblem.id = uniqueId('review-no-escape-problem');
  // The label says the reason is required; the control says so too, and both it
  // and the box point at the message that appears when it is missing.
  noEscapeReason.required = true;
  noEscapeReason.setAttribute('aria-describedby', `${noEscapeHint.id} ${noEscapeProblem.id}`);
  noEscapeBox.setAttribute('aria-describedby', `${noEscapeHint.id} ${noEscapeProblem.id}`);

  noEscapeBox.addEventListener('change', () => {
    const layer = layerOrNull();
    if (!layer) {
      noEscapeBox.checked = !noEscapeBox.checked;
      return;
    }
    if (!noEscapeBox.checked) {
      noEscapeProblem.hidden = true;
      commit(revertNoEscape(layer), 'Confirmation that the animal never escaped removed');
      return;
    }
    const reason = noEscapeReason.value.trim();
    if (reason === '') {
      noEscapeBox.checked = false;
      noEscapeProblem.hidden = false;
      noEscapeProblem.textContent = 'Say why you are confirming this before ticking the box.';
      noEscapeReason.focus();
      return;
    }
    noEscapeProblem.hidden = true;
    commit(setNoEscape(layer, reason, newMeta()), 'Confirmed: the animal never entered the escape box');
  });

  // Editing the reason of a confirmation already on file re-commits it. Without this the field is
  // enabled, pre-filled and editable, and the next render silently puts the stored text back — the
  // only way to fix a typo would be to revert the correction and make it again.
  noEscapeReason.addEventListener('change', () => {
    const layer = currentLayer();
    const entry = layer ? noEscapeCorrection(layer) : null;
    if (!layer || entry === null) return;
    const reason = noEscapeReason.value.trim();
    if (reason === '' || reason === entry.reason) {
      noEscapeReason.value = entry.reason;
      return;
    }
    // `setNoEscape` coalesces, so the entry keeps its id and the corrections list does not grow.
    commit(setNoEscape(layer, reason, newMeta()), `Reason for the confirmed non-escape changed to: ${reason}`);
  });

  const noEscapeField = el('div', { class: 'no-escape-field' }, [
    el('div', { class: 'field' }, [
      noEscapeBox,
      el('label', { text: 'Confirmed: never entered the escape box', attrs: { for: noEscapeBox.id } }),
    ]),
    el('div', { class: 'field' }, [
      el('label', { text: 'Reason (required)', attrs: { for: noEscapeReason.id } }),
      noEscapeReason,
    ]),
    noEscapeHint,
    noEscapeProblem,
  ]);

  /** Keeps the checkbox, its reason and its hint on what the current analysis says. */
  function renderNoEscape(): void {
    const layer = currentLayer();
    const entry = layer ? noEscapeCorrection(layer) : null;
    const escaped = analysis?.metrics.escaped === true;
    // Any escape entry, not only one that ended the trial: an entry too short to be persistent is
    // still an entry the tool found at the escape hole, and the engine flags it the same way.
    const firstEntry = (analysis?.events ?? [])
      .filter((ev) => ev.kind === 'escape_entry')
      .reduce<EventRecord | null>((a, b) => (a === null || b.startFrame < a.startFrame ? b : a), null);
    const contradicted = entry !== null && firstEntry !== null;

    noEscapeBox.checked = entry !== null;
    // Disabled only when there is nothing to confirm — never while a confirmation stands, or the
    // user could not untick their own correction (D25: every correction is revertable).
    noEscapeBox.disabled = analysis === null || (firstEntry !== null && entry === null);
    noEscapeReason.disabled = noEscapeBox.disabled;
    // Only write back a reason there is one for. Blanking the field on every render threw away a
    // reason typed but not yet ticked as soon as anything else re-rendered — clicking the timeline
    // to check the video, which is exactly what a user does before confirming.
    if (entry !== null && document.activeElement !== noEscapeReason) noEscapeReason.value = entry.reason;

    const endFrame = analysis ? positionToFrame(analysis.cleanedTrack, analysis.trial.endFrame) : null;
    const when =
      escaped && analysis && endFrame !== null
        ? formatFrameTime(endFrame, analysis.trial.endTime_s)
        : firstEntry
          ? formatFrameTime(firstEntry.startFrame, firstEntry.startTime_s)
          : 'a frame of this trial';
    const shortOfEnding = escaped ? '' : ' (too short to end the trial, or outside it)';
    noEscapeHint.textContent =
      analysis === null
        ? 'Analyse the video first.'
        : contradicted
          ? `Contradicted: an escape entry at ${when}${shortOfEnding} stands against this confirmation, so the trial is still for review. Untick this, or revert what produced the entry.`
          : firstEntry !== null
            ? `Nothing to confirm: this trial has an escape entry at ${when}${shortOfEnding}.${escaped ? '' : ' If that entry is not real, delete it first and then confirm.'}`
            : 'Ticking this says the animal genuinely never went in, which is what lets the trial read ok.';
  }

  const playButton = button('Play / pause (Space)', () => togglePlay());

  // A group, not a toolbar: the arrows step frames here, they do not move between the buttons.
  const toolbar = el('div', { class: 'review-tools', attrs: { role: 'group', 'aria-label': 'Correction tools' } }, [
    el('div', { class: 'tool-group' }, [el('span', { text: 'Point' }), noseButton, centroidButton, toolOffButton, invalidButton]),
    el('div', { class: 'tool-group' }, [el('span', { text: 'Range' }), notVisibleButton, escapeBoxButton, escapeBoxHint]),
    el('div', { class: 'tool-group' }, [
      el('span', { text: 'Event' }),
      addEventButton,
      deleteEventButton,
      el('div', { class: 'field' }, [el('label', { text: 'Hole (H)', attrs: { for: holeSelect.id } }), holeSelect]),
      edgeStartButton,
      edgeEndButton,
    ]),
    el('div', { class: 'tool-group' }, [el('span', { text: 'Trial' }), trialStartButton, revertTrialStartButton, noEscapeField]),
    el('div', { class: 'tool-group' }, [playButton]),
  ]);

  function setTool(next: PointTool): void {
    tool = next;
    painting = null;
    hoverPoint = null;
    for (const [control, value] of [
      [noseButton, 'nose'],
      [centroidButton, 'centroid'],
    ] as const) {
      control.classList.toggle('is-active', tool === value);
      control.setAttribute('aria-pressed', tool === value ? 'true' : 'false');
    }
    context.announce(
      tool === 'off'
        ? 'Point tool off: the arrow keys step frames again.'
        : `${tool === 'nose' ? 'Nose' : 'Centroid'} armed: click the frame to place it, or use the arrow keys to nudge it (Shift for 10 px). X marks it invalid, Escape disarms.`,
    );
    canvasView.requestDraw();
    renderStatus();
  }

  function selectEdge(edge: EventEdge | null): void {
    if (!selectedEvent()) {
      context.announce('Select an event first (click a bar on the timeline, or press E).');
      return;
    }
    selectedEdge = selectedEdge === edge ? null : edge;
    timeline.setSelection(selectedEventId, selectedEdge);
    edgeStartButton.setAttribute('aria-pressed', selectedEdge === 'start' ? 'true' : 'false');
    edgeEndButton.setAttribute('aria-pressed', selectedEdge === 'end' ? 'true' : 'false');
    edgeStartButton.classList.toggle('is-active', selectedEdge === 'start');
    edgeEndButton.classList.toggle('is-active', selectedEdge === 'end');
    context.announce(
      selectedEdge === null
        ? 'No edge selected: Shift with the arrows steps ten frames.'
        : `${selectedEdge === 'start' ? 'Start' : 'End'} edge selected: Shift + ← / → moves it one frame.`,
    );
    renderStatus();
  }

  // ---- keyboard -----------------------------------------------------------------------------

  function dispatch(action: ReviewAction, shift: boolean): void {
    const big = shift ? NUDGE_PX_LARGE : NUDGE_PX;
    switch (action) {
      case 'step-back':
        seek(playhead - 1, true);
        break;
      case 'step-forward':
        seek(playhead + 1, true);
        break;
      case 'step-back-10':
        seek(playhead - 10, true);
        break;
      case 'step-forward-10':
        seek(playhead + 10, true);
        break;
      case 'home':
        seek(0, true);
        break;
      case 'end':
        seek(frameCount() - 1, true);
        break;
      case 'prev-flagged-event':
        goToQueued(-1);
        break;
      case 'next-flagged-event':
        goToQueued(1);
        break;
      case 'prev-flag':
      case 'next-flag': {
        if (!model) return;
        const run = nextSpan(flaggedRuns(model), playhead, action === 'next-flag' ? 1 : -1);
        if (!run) {
          context.announce(action === 'next-flag' ? 'No flagged run after this frame.' : 'No flagged run before this frame.');
          return;
        }
        seek(run.startFrame, false);
        context.announce(`Flagged run: ${run.reason}, frames ${run.startFrame}–${run.endFrame}.`);
        break;
      }
      case 'prev-event':
      case 'next-event': {
        if (!model) return;
        const ev = nextSpan(model.events, playhead, action === 'next-event' ? 1 : -1);
        if (!ev) {
          context.announce(action === 'next-event' ? 'No event after this frame.' : 'No event before this frame.');
          return;
        }
        selectedEventId = ev.id;
        selectedEdge = null;
        timeline.setSelection(ev.id, null);
        seek(ev.startFrame, false);
        context.announce(`${KIND_WORDS[ev.kind]} ${ev.label}${ev.corrected ? ' (user)' : ''}, frames ${ev.startFrame}–${ev.endFrame}, selected.`);
        renderEventsTable();
        renderQueue();
        break;
      }
      case 'focus-frame-field':
        scrubber.frameField.focus();
        scrubber.frameField.select();
        break;
      case 'play-pause':
        togglePlay();
        break;
      case 'zoom-in':
        timeline.zoomBy(ZOOM_STEP);
        break;
      case 'zoom-out':
        timeline.zoomBy(1 / ZOOM_STEP);
        break;
      case 'zoom-fit':
        timeline.zoomFit();
        break;
      case 'tool-nose':
        setTool('nose');
        break;
      case 'tool-centroid':
        setTool('centroid');
        break;
      case 'cancel':
        if (painting) {
          painting = null;
          context.announce('Cancelled.');
        } else if (tool !== 'off') {
          setTool('off');
        } else {
          selectedEventId = null;
          selectedEdge = null;
          timeline.setSelection(null, null);
          renderEventsTable();
          renderQueue();
          context.announce('Selection cleared.');
        }
        renderStatus();
        break;
      case 'nudge-left':
        nudgePoint(-big, 0);
        break;
      case 'nudge-right':
        nudgePoint(big, 0);
        break;
      case 'nudge-up':
        nudgePoint(0, -big);
        break;
      case 'nudge-down':
        nudgePoint(0, big);
        break;
      case 'mark-invalid':
        markInvalid();
        break;
      case 'paint-not-visible':
        paintNotVisible();
        break;
      case 'mark-escape-box':
        markEscapeBox();
        break;
      case 'add-event':
        addEventHere();
        break;
      case 'delete-event':
        deleteSelected();
        break;
      case 'keep-event':
        keepSelected();
        break;
      case 'relabel-event':
        if (!selectedEvent()) {
          context.announce('Select an event first (click a bar on the timeline, or press E).');
          return;
        }
        holeSelect.focus();
        break;
      case 'edge-start':
        selectEdge('start');
        break;
      case 'edge-end':
        selectEdge('end');
        break;
      case 'retime-back':
      case 'retime-forward': {
        const ev = selectedEvent();
        if (!ev || !selectedEdge) return;
        const at = (selectedEdge === 'start' ? ev.startFrame : ev.endFrame) + (action === 'retime-back' ? -1 : 1);
        retimeSelected(selectedEdge, Math.max(0, Math.min(frameCount() - 1, at)));
        break;
      }
      case 'trial-start-here':
        trialStartHere();
        break;
    }
  }

  // Listened for on the document, not the step: a mirror re-render replaces the button that was
  // just activated, which drops focus onto the body — outside the step — and a listener on the
  // step alone would then hear nothing until the user tabbed all the way back in. Keys are
  // taken from inside the step, or from a stranded body focus while the step is the one shown.
  const stepIsShown = (): boolean => body.isConnected && body.offsetParent !== null;
  document.addEventListener('keydown', (event) => {
    const target = event.target as HTMLElement | null;
    const inside = target !== null && body.contains(target);
    if (!inside && !(target === document.body && stepIsShown())) return;
    const tag = target?.tagName;
    const editing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA';
    if (editing && event.key !== 'Escape') return;
    if (tag === 'BUTTON' && (event.key === ' ' || event.key === 'Enter')) return;
    if (tag === 'SUMMARY' && (event.key === ' ' || event.key === 'Enter')) return;
    const action = resolveKey(event, { pointTool: tool !== 'off', edgeSelected: selectedEdge !== null && selectedEventId !== null });
    if (!action) return;
    // The frame view zooms itself on + − 0; those keys are the frame's when it has focus.
    if ((action === 'zoom-in' || action === 'zoom-out' || action === 'zoom-fit') && target && canvasView.viewport.contains(target)) return;
    event.preventDefault();
    dispatch(action, event.shiftKey);
    // Escape in a field or select hands the keyboard back to the timeline.
    if (editing) timeline.surface.focus();
  });

  // ---- layout ------------------------------------------------------------------------------

  const videoSelect = el('select', { id: uniqueId('review-video') });
  videoSelect.addEventListener('change', () => {
    selectedVideoId = videoSelect.value;
    selectedEventId = null;
    selectedEdge = null;
    painting = null;
    stopPlaying(false);
    playhead = 0;
    render();
    seek(0, false);
  });
  const timing = el('p', { class: 'review-timing', attrs: { 'aria-live': 'off' } });
  const note = el('p', { class: 'review-note' });

  /*
   * The current-event strip: directly under the video and the toolbar, where
   * the user is already looking. It names the selected event, says why it is in
   * the queue, and gives the three keys that decide it — so walking the queue
   * with `]` does not need a glance at the cards far below, and nothing has to
   * scroll to make the work visible.
   *
   * The queue count and the two buttons live here rather than in a bar of their
   * own: how much is left and what is in front of you are one thought. The
   * per-video count in the video selector is untouched.
   */
  const queueCount = el('strong', { class: 'queue-count', attrs: { role: 'status' } });
  const queuePrevious = button('Previous flagged', () => goToQueued(-1), {
    class: 'queue-step',
    attrs: { 'aria-keyshortcuts': '[' },
  });
  const queueNext = button('Next flagged', () => goToQueued(1), {
    class: 'queue-step',
    attrs: { 'aria-keyshortcuts': ']' },
  });
  const keepButton = button('Keep (K)', () => keepSelected(), {
    class: 'queue-step',
    attrs: { 'aria-keyshortcuts': 'K' },
  });
  const currentEventLine = el('p', { class: 'current-event-line' });
  // The keys are the ones already bound in `REVIEW_KEYS`; this adds none.
  const currentEventHint = el('p', {
    class: 'current-event-hint hint',
    text: 'Relabel: H then the hole number · Delete: ⌫ · Keep as it is: K',
    attrs: { hidden: true },
  });
  const queueBar = el(
    'div',
    {
      id: 'review-current-event',
      class: 'review-current-event',
      attrs: { 'aria-live': 'polite' },
    },
    [
      currentEventLine,
      currentEventHint,
      el('div', { class: 'current-event-actions' }, [queueCount, keepButton, queuePrevious, queueNext]),
    ],
  );
  const status = el('p', { class: 'review-status', attrs: { 'aria-live': 'off' } });

  const legend = disclosure('Keyboard', [
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'mirror-table key-legend' }, [
        el('caption', { text: 'Every action of this step from the keyboard. Alt with the arrows pans the frame; + − 0 on the frame zoom it.' }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Keys', attrs: { scope: 'col' } }),
            el('th', { text: 'Does', attrs: { scope: 'col' } }),
            el('th', { text: 'When', attrs: { scope: 'col' } }),
          ]),
        ]),
        el(
          'tbody',
          {},
          keyLegend().map((row) =>
            el('tr', {}, [
              el('th', { text: row.keys, attrs: { scope: 'row' } }),
              el('td', { text: row.description }),
              el('td', {
                text:
                  row.when === 'point-tool'
                    ? 'a point tool is armed'
                    : row.when === 'edge-selected'
                      ? 'an event edge is selected'
                      : row.when === 'no-point-tool'
                        ? 'no point tool armed'
                        : 'always',
              }),
            ]),
          ),
        ),
      ]),
    ]),
  ]);

  /*
   * The mount points for chunk 7a's four components. They are the boxes and
   * nothing else: each component root is itself a `<section aria-labelledby>`
   * carrying its own `<h3>`, so the region and its name come from the component
   * and these are plain `<div>`s with no `aria-labelledby` of their own. A
   * `<section>` here would be a second, unnamed region wrapping a named one.
   */
  const parametersPanel = el('div', { id: 'review-parameters', class: 'review-panel', attrs: { 'data-panel': 'parameters' } });
  const metricsPanel = el('div', { id: 'review-metrics', class: 'review-panel', attrs: { 'data-panel': 'metrics' } });
  const eventsPanel = el('div', { id: 'review-events', class: 'review-panel review-panel-wide', attrs: { 'data-panel': 'events' } });
  const qualityPanel = el('div', { id: 'review-quality', class: 'review-panel', attrs: { 'data-panel': 'quality' } });

  /** Where the figures and the export mount; each section itself is its module's. */
  const figuresHost = el('div', { class: 'review-figures-host' });
  const exportHost = el('div', { class: 'review-export-host' });

  const framesBody = el('tbody');
  const framesSummary = el('p', { class: 'mirror-summary' });
  const framesMirror = el('section', { class: 'mirror' }, [
    el('h3', { text: 'Frames around the playhead' }),
    framesSummary,
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'mirror-table' }, [
        el('caption', { text: `The ${FRAME_TABLE_RADIUS} frames either side of the current frame: what the overlay draws, with the source of every point.` }),
        el('thead', {}, [
          el('tr', {}, [
            ...['Frame', 't (s)', 'State', 'Reason', 'Centroid x', 'Centroid y', 'Centroid source', 'Nose x', 'Nose y', 'Nose conf.', 'Nose source', 'Event', 'Corrections'].map((text) =>
              el('th', { text, attrs: { scope: 'col' } }),
            ),
          ]),
        ]),
        framesBody,
      ]),
    ]),
  ]);

  /*
   * The events mirror. It used to be what `#review-events` held; the event list
   * (cards, with the evidence and the shadow values in prose) took that place,
   * and this table came down here with the other two mirrors — D37 asks for a
   * table of what the timeline draws and D26 for a source column in every one,
   * and a card is neither. Closed by default: it repeats what is above it.
   */
  const eventsMirrorBody = el('div');
  const eventsMirror = el('section', { id: 'review-events-mirror', class: 'mirror' }, [
    el('h3', { text: 'Events' }),
    disclosure('Every event as a table', [eventsMirrorBody]),
  ]);

  const correctionsList = el('ol', { class: 'corrections-list' });
  const correctionsSummary = el('p', { class: 'mirror-summary' });
  const correctionsMirror = el('section', { class: 'mirror' }, [
    el('h3', { text: 'Corrections' }),
    correctionsSummary,
    correctionsList,
  ]);

  body.append(
    el('div', { class: 'review-top' }, [
      el('div', { class: 'field' }, [el('label', { text: 'Video', attrs: { for: videoSelect.id } }), videoSelect]),
      timing,
    ]),
    note,
    status,
    scrubber.element,
    // Video and toolbar side by side on a wide screen, stacked below 1200 px
    // (app.css). The timeline stays outside, full width, on its own row.
    el('div', { class: 'review-stage' }, [canvasView.element, toolbar]),
    queueBar,
    timeline.element,
    legend,
    el('div', { class: 'review-panels' }, [parametersPanel, metricsPanel, qualityPanel, eventsPanel]),
    figuresHost,
    exportHost,
    framesMirror,
    eventsMirror,
    correctionsMirror,
  );

  // ---- rendering --------------------------------------------------------------------------

  /**
   * Re-derives anything the store invalidated but nothing has recomputed yet.
   *
   * The store drops the derived cache whenever the parameters, the maze map or a
   * transform changes, and on every session load — so a video with no cache is a
   * video that needs deriving, not one that was never analysed. Without this,
   * loading a session file or nudging the maze left an analysed cohort looking
   * unanalysed: empty figures, a disabled export button, and the "N of M not
   * analysed" line stating something false. `ensureAnalysis` covers the video on
   * screen; this covers the rest, which is what the figures and the export count.
   */
  function sweepMissingAnalyses(): void {
    if (sweeping) return;
    // A derive that throws would otherwise be retried on every notification for
    // ever, silently, while the figures said only "not analysed yet" and offered
    // the Track step — which cannot help, because the video *is* tracked. The
    // failures are remembered until an input changes, and the reason is shown.
    const inputs = { mazeMap: store.current.mazeMap, parameters: store.current.parameters };
    if (failedInputs?.mazeMap !== inputs.mazeMap || failedInputs?.parameters !== inputs.parameters) {
      failedAnalyses.clear();
      failedInputs = inputs;
    }
    const stale = store.videos.some(
      (video) =>
        analysisBlockedReason(store, video.id) === null &&
        !store.analysisFor(video.id)?.derived &&
        !failedAnalyses.has(video.id),
    );
    if (!stale) return;
    sweeping = true;
    let run;
    try {
      run = analyseMissing(store);
    } finally {
      sweeping = false;
    }
    for (const [videoId, reason] of run.skipped) {
      // Only a throw, not "not tracked yet" — that one the Track step does fix.
      if (analysisBlockedReason(store, videoId) !== null) continue;
      if (failedAnalyses.has(videoId)) continue;
      failedAnalyses.set(videoId, reason);
      const name = store.videoById(videoId)?.filename ?? videoId;
      context.announce(`${name} could not be analysed: ${reason}`);
    }
  }

  /** The reason each failed video failed, in the words the figures show. */
  function analysisProblems(): string[] {
    return [...failedAnalyses].map(
      ([videoId, reason]) => `${store.videoById(videoId)?.filename ?? videoId} — ${reason}`,
    );
  }

  function render(): void {
    if (deriving || sweeping) return;
    if (store.epoch !== lastEpoch) {
      lastEpoch = store.epoch;
      lastVideoId = null;
      lastTimebaseSource = null;
      selectedVideoId = null;
      selectedEventId = null;
      selectedEdge = null;
      painting = null;
      tool = 'off';
      cacheKey = null;
      stopPlaying(false);
    }
    const video = currentVideo();
    ensureAnalysis();
    sweepMissingAnalyses();
    // After the derive, not before: the option labels carry this video's queue
    // count, and reading it first would show the count from before the edit.
    syncSelect(
      videoSelect,
      store.videos.map((v) => ({ value: v.id, label: videoOptionLabel(v) })),
      video?.id ?? '',
    );

    const isAttached = video !== null && store.isAttached(video.id);
    // The scrubber runs on the file's frame table when the video is attached and on the
    // track otherwise; either can arrive after the video did (a restore emits more than
    // once), so the timebase source is part of the key, not just the video.
    const attachment = video ? store.attachmentFor(video.id) : undefined;
    const timebaseSource: unknown = attachment?.index ?? (analysis ? 'track' : null);
    if (video && (video.id !== lastVideoId || timebaseSource !== lastTimebaseSource)) {
      lastVideoId = video.id;
      lastTimebaseSource = timebaseSource;
      if (attachment) {
        scrubber.setIndex(attachment.index);
        canvasView.setVideoSize(attachment.index.width, attachment.index.height);
        void showFrame(playhead);
      } else {
        scrubber.setIndex(analysis ? { frameCount: analysis.cleanedTrack.length, frames: analysis.cleanedTrack } : null);
        canvasView.setVideoSize(video.referenceResolution.width, video.referenceResolution.height);
        canvasView.setFrame(null);
      }
    }
    note.hidden = video === null || isAttached;
    note.textContent = video
      ? `${video.filename} is not attached, so no frame can be shown: drop the file again on the Videos step. The track, the timeline and every correction still work.`
      : '';

    const blocked = video ? analysisBlockedReason(store, video.id) : 'no video';
    for (const control of [noseButton, centroidButton, toolOffButton, invalidButton, notVisibleButton, escapeBoxButton, addEventButton, deleteEventButton, holeSelect, edgeStartButton, edgeEndButton, trialStartButton, revertTrialStartButton, playButton]) {
      control.disabled = analysis === null;
    }
    timing.textContent = analysis && lastTiming
      ? `Recomputed in ${lastTiming.deriveMs.toFixed(1)} ms (${lastTiming.totalMs.toFixed(0)} ms with the cache write) · ${analysis.cleanedTrack.length} frames · ${currentLayer()?.entries.length ?? 0} correction${(currentLayer()?.entries.length ?? 0) === 1 ? '' : 's'} · parameters ${analysis.parametersHash.slice(0, 8)}…`
      : blocked
        ? `Not analysed: ${blocked}.`
        : '';

    if (analysis) {
      const holes = analysis.geometry.holeCount;
      syncSelect(
        holeSelect,
        Array.from({ length: holes }, (_, i) => ({ value: String(i), label: i === analysis!.geometry.targetIndex ? `${i} (target)` : String(i) })),
        selectedEvent()?.holeIndex?.toString() ?? holeSelect.value,
      );
    }
    timeline.setModel(model);
    timeline.setPlayhead(playhead);
    timeline.setSelection(selectedEventId, selectedEdge);
    renderPanels();
    renderFigures();
    renderExport();
    renderEventsTable();
    renderFrameTable();
    renderCorrections();
    renderQueue();
    renderStatus();
    canvasView.requestDraw();
  }

  function renderStatus(): void {
    const parts: string[] = [];
    if (tool !== 'off') parts.push(`${tool} armed — click the frame or use the arrows`);
    if (painting) parts.push(painting.kind === 'not_visible' ? `marking not visible from frame ${painting.startFrame}: press V at the last frame` : `adding an investigation from frame ${painting.startFrame}: press A at the last frame`);
    if (playing) parts.push('playing');
    const ev = selectedEvent();
    if (ev) parts.push(`selected: ${KIND_WORDS[ev.kind]} ${ev.holeIndex ?? ''} frames ${ev.startFrame}–${ev.endFrame}${selectedEdge ? ` (${selectedEdge} edge)` : ''}`);
    if (hoverText) parts.push(hoverText);
    status.textContent = parts.join(' · ');
  }

  function renderEventsTable(): void {
    if (!analysis) {
      replaceChildren(eventsMirrorBody, [el('p', { class: 'hint', text: 'No analysis yet.' })]);
      return;
    }
    const counts = { investigation: 0, escape_entry: 0, tracking_failure: 0 };
    for (const ev of analysis.events) counts[ev.kind]++;
    const unlikely = unlikelyEventIds(analysis);
    const tbody = el('tbody');
    for (const ev of analysis.events) {
      const selected = ev.id === selectedEventId;
      const row = el('tr', { class: `${ev.source === 'corrected' ? 'is-corrected ' : ''}${ev.isTarget ? 'is-target ' : ''}${selected ? 'is-selected' : ''}`.trim() }, [
        el('th', { attrs: { scope: 'row' } }, [
          button(`${KIND_WORDS[ev.kind]}`, () => {
            selectedEventId = ev.id;
            selectedEdge = null;
            timeline.setSelection(ev.id, null);
            seek(ev.startFrame, true);
            renderEventsTable();
            renderQueue();
            timeline.surface.focus(); // the table was rebuilt under this button
          }, { class: 'metric-value', attrs: { 'aria-label': `Seek to ${KIND_WORDS[ev.kind]} at frame ${ev.startFrame} and select it` } }),
        ]),
        el('td', { text: ev.holeIndex === null ? '—' : String(ev.holeIndex) }),
        el('td', { text: ev.isTarget ? 'target' : '' }),
        el('td', { text: `${ev.startFrame}–${ev.endFrame}` }),
        el('td', { text: ev.startTime_s.toFixed(2) }),
        el('td', { text: ev.durationSeconds.toFixed(2) }),
        el('td', { text: ev.pointUsed }),
        el('td', { text: ev.minNoseDistance_cm === null ? '—' : ev.minNoseDistance_cm.toFixed(1) }),
        el('td', { text: Number.isFinite(ev.minCentroidDistance_cm) ? ev.minCentroidDistance_cm.toFixed(1) : '—' }),
        el('td', {
          text:
            ev.source === 'corrected'
              ? isConfirmed(ev)
                ? 'user · confirmed, no change'
                : ev.autoShadow
                  ? `user (auto: hole ${ev.autoShadow.holeIndex ?? '—'}, frames ${ev.autoShadow.startFrame}–${ev.autoShadow.endFrame})`
                  : 'user'
              : 'auto',
        }),
        el('td', { text: unlikely.has(ev.id) ? 'physically unlikely — review' : '' }),
        el('td', {}, [
          disclosure('Evidence', [el('p', { text: ev.evidence })]),
        ]),
      ]);
      tbody.append(row);
    }
    replaceChildren(eventsMirrorBody, [
      el('p', { class: 'mirror-summary', text: `${counts.investigation} investigation${counts.investigation === 1 ? '' : 's'} · ${counts.escape_entry} escape entr${counts.escape_entry === 1 ? 'y' : 'ies'} · ${counts.tracking_failure} tracking failure${counts.tracking_failure === 1 ? '' : 's'}. A hatched row was corrected by hand; its automatic values stay in the Source column.` }),
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'mirror-table' }, [
          el('caption', { text: 'Every event the timeline draws. The first cell seeks to the event and selects it.' }),
          el('thead', {}, [
            el('tr', {}, [
              ...['Kind', 'Hole', 'Target', 'Frames', 'Start (s)', 'Duration (s)', 'Point used', 'Min nose (cm)', 'Min centroid (cm)', 'Source', 'Flag', 'Evidence'].map((text) =>
                el('th', { text, attrs: { scope: 'col' } }),
              ),
            ]),
          ]),
          tbody,
        ]),
      ]),
    ]);
  }

  function renderFrameTable(): void {
    if (!analysis) {
      framesSummary.textContent = 'No analysis yet.';
      replaceChildren(framesBody, []);
      return;
    }
    const track = analysis.cleanedTrack;
    const layer = currentLayer();
    const from = Math.max(0, playhead - FRAME_TABLE_RADIUS);
    const to = Math.min(track.length - 1, playhead + FRAME_TABLE_RADIUS);
    const here = track[playhead];
    framesSummary.textContent = here
      ? `Current: ${formatFrameTime(playhead, here.t_s)} · ${STATE_WORDS[here.detectionState]} (${here.reason}) · centroid ${here.centroid.valid ? `${here.centroid.x.toFixed(1)}, ${here.centroid.y.toFixed(1)} (${here.centroid.source})` : 'not positioned'} · nose ${here.nose.valid ? `${here.nose.x.toFixed(1)}, ${here.nose.y.toFixed(1)} (${here.nose.source}, confidence ${here.noseHeadingConfidence.toFixed(2)})` : 'not available'}.`
      : '';
    const rows: Child[] = [];
    for (let f = from; f <= to; f++) {
      const frame = track[f]!;
      const ev = eventAtFrame(model?.events ?? [], f);
      const marks = layer ? layer.entries.filter((e) => (e.kind === 'point' && e.frameIndex === f) || (e.kind === 'range' && e.startFrame <= f && f <= e.endFrame) || (e.kind === 'trial_start' && e.frameIndex === f)) : [];
      rows.push(
        el('tr', { class: `${f === playhead ? 'is-target ' : ''}${marks.length > 0 ? 'is-corrected' : ''}`.trim() }, [
          el('th', { attrs: { scope: 'row' } }, [
            button(
              String(f),
              () => {
                seek(f, true);
                timeline.surface.focus(); // the rows were rebuilt under this button
              },
              { class: 'metric-value', attrs: { 'aria-label': `Seek to frame ${f}` } },
            ),
          ]),
          el('td', { text: frame.t_s.toFixed(3) }),
          el('td', { text: STATE_WORDS[frame.detectionState] }),
          el('td', { text: frame.reason }),
          el('td', { text: frame.centroid.valid ? frame.centroid.x.toFixed(1) : '—' }),
          el('td', { text: frame.centroid.valid ? frame.centroid.y.toFixed(1) : '—' }),
          el('td', { text: frame.centroid.source }),
          el('td', { text: frame.nose.valid ? frame.nose.x.toFixed(1) : '—' }),
          el('td', { text: frame.nose.valid ? frame.nose.y.toFixed(1) : '—' }),
          el('td', { text: frame.nose.valid ? frame.noseHeadingConfidence.toFixed(2) : '—' }),
          el('td', { text: frame.nose.source }),
          el('td', { text: ev ? `${KIND_WORDS[ev.kind]} ${ev.label}${ev.corrected ? ' (user)' : ''}` : '' }),
          el('td', { text: marks.map((m) => describeCorrection(m)).join('; ') }),
        ]),
      );
    }
    replaceChildren(framesBody, rows);
  }

  /**
   * `describeCorrection` with one thing it cannot know: an event edit whose
   * values are the automatic ones is a confirmation, not an edit, and the only
   * way to tell is to look at the event it addresses (there is no stored flag —
   * see `confirmEvent`). Everything else is the shared pure sentence.
   */
  function describeEntry(entry: CorrectionEntry): string {
    if (entry.kind === 'event' && entry.action === 'edit' && entry.eventId !== undefined) {
      const ev = analysis?.events.find((candidate) => candidate.id === entry.eventId);
      if (ev && isConfirmed(ev)) return `Event ${entry.eventId} confirmed by the user, no change`;
    }
    return describeCorrection(entry);
  }

  function renderCorrections(): void {
    const layer = currentLayer();
    if (!layer || !analysis) {
      correctionsSummary.textContent = 'No analysis yet.';
      replaceChildren(correctionsList, []);
      return;
    }
    const orphans = new Map(orphanedCorrections(layer, analysis.reviewFlags).map((o) => [o.entry.id, o.flag]));
    correctionsSummary.textContent =
      layer.entries.length === 0
        ? 'No corrections: everything shown is automatic.'
        : `${layer.entries.length} correction${layer.entries.length === 1 ? '' : 's'}, newest last. Each can be reverted on its own; the automatic values are never overwritten.${orphans.size > 0 ? ` ${orphans.size} no longer match${orphans.size === 1 ? 'es' : ''} an automatic event under the current parameters.` : ''}`;
    replaceChildren(
      correctionsList,
      [...layer.entries]
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0))
        .map((entry) => {
          const orphan = orphans.get(entry.id);
          const frame =
            entry.kind === 'point' || entry.kind === 'trial_start' ? entry.frameIndex : entry.kind === 'range' ? entry.startFrame : entry.kind === 'event' ? (entry.startFrame ?? null) : null;
          return el('li', { class: orphan ? 'is-orphan' : '' }, [
            el('span', { text: describeEntry(entry) }),
            ' ',
            el('span', { class: 'hint', text: `(${entry.timestamp.replace('T', ' ').slice(0, 19)})` }),
            ' ',
            orphan ? el('span', { class: 'orphan', text: `no longer matches an automatic event: ${orphan.message}` }) : null,
            ' ',
            frame !== null
              ? button(
                  'Seek',
                  () => {
                    seek(frame, true);
                    timeline.surface.focus();
                  },
                  { attrs: { 'aria-label': `Seek to frame ${frame}` } },
                )
              : null,
            ' ',
            button('Revert to automatic', () => {
              const current = currentLayer();
              if (!current) return;
              if (entry.kind === 'event' && entry.eventId && entry.action !== 'add') {
                commit(revertEvent(current, entry.eventId), `Reverted: ${describeCorrection(entry)}`);
              } else {
                commit(revertCorrection(current, entry.id), `Reverted: ${describeCorrection(entry)}`);
              }
              // The list was rebuilt under this button; keep the keyboard in the step.
              timeline.surface.focus();
            }),
          ]);
        }),
    );
  }

  // ---- the four panels (chunk 7a's components) ------------------------------------------------

  /**
   * Built on the first analysis and then only ever `update()`d. Rebuilding them
   * on every recompute interrupts a slider drag about every 100 ms and loses the
   * focused event card — the defect chunk 7a found in its own harness and the
   * reason `update()` exists. Only the transition to "no analysis at all" takes
   * the three analysis-fed panels down; switching video is an update, not a
   * remount.
   */
  let parametersComponent: Component<ParametersPanelProps> | null = null;
  let metricsComponent: Component<MetricsCardProps> | null = null;
  let eventsComponent: Component<EventListProps> | null = null;
  let qualityComponent: Component<QualityPanelProps> | null = null;
  let figures: ReviewFigures | null = null;
  let exporter: ReviewExport | null = null;

  /**
   * The panel calls `onParametersChange` and then announces what the user
   * changed. The badge only exists after that recompute, so it is parked here
   * and appended to the panel's own sentence: one utterance per change, not one
   * per control and not two that overwrite each other (D37).
   */
  let pendingReflow = '';

  const seekCallbacks: SeekCallbacks = {
    onSeek: (frame) => seek(positionOfFrame(frame), true),
    onAnnounce: context.announce,
  };

  const strategyCallbacks: StrategyCallbacks = {
    ...seekCallbacks,
    onOverride: (strategy, reason) => {
      const layer = layerOrNull();
      if (!layer) return;
      commit(setStrategyOverride(layer, strategy, reason, newMeta()), `Strategy set to ${strategy} by hand`);
    },
    onRevert: (id) => {
      const layer = layerOrNull();
      if (!layer) return;
      commit(revertCorrection(layer, id), 'Strategy override removed');
    },
  };

  /**
   * The components address frames by sample-table index; this step's playhead is
   * a position in `cleanedTrack`. `timelineModel` refuses a track where the two
   * differ (chunk 6), so today this is the identity — written out anyway, because
   * a D42 import is exactly the case that would break the assumption.
   */
  function positionOfFrame(frameIndex: number): number {
    const track = analysis?.cleanedTrack;
    if (!track || track.length === 0) return 0;
    if (track[frameIndex]?.frameIndex === frameIndex) return frameIndex;
    const found = track.findIndex((frame) => frame.frameIndex === frameIndex);
    return found >= 0 ? found : Math.max(0, Math.min(track.length - 1, frameIndex));
  }

  /**
   * One threshold change re-derives the whole cohort, not just the video on
   * screen: the parameters are shared (D28), so every video's numbers move at
   * once, and an export assembled from three videos derived under two parameter
   * sets is the defect the trust audit found (A2).
   *
   * The sweep runs with rendering held off — `setDerivedLayer` notifies once per
   * video — and the video on screen takes its result from the sweep rather than
   * being derived a second time. Autosave is unaffected: `changed()` debounces,
   * so the whole reflow still lands as one write.
   */
  function onParametersChange(next: Parameters): void {
    const started = performance.now();
    let sweep;
    sweeping = true;
    try {
      store.setParameters(next); // drops every derived cache (A2)
      sweep = analyseAllVideos(store);
    } finally {
      sweeping = false;
    }
    const video = currentVideo();
    const run = video ? sweep.runs.get(video.id) : undefined;
    if (video && run) adopted = { videoId: video.id, run };
    render();

    const badge = describeDiff(video ? (previousByVideo.get(video.id) ?? null) : null, analysis);
    const derives = sweep.runs.size;
    const timing = derives > 0
      ? ` ${derives} video${derives === 1 ? '' : 's'} recomputed in ${sweep.deriveMs.toFixed(1)} ms (${(performance.now() - started).toFixed(0)} ms with the redraw).`
      : '';
    const skipped = sweep.skipped.size > 0
      ? ` ${sweep.skipped.size} not analysed: ${[...sweep.skipped.values()][0]}.`
      : '';
    pendingReflow = `${badge}${timing}${skipped}`;
  }

  /**
   * The figures follow the same rule as the panels: created once, updated on
   * every recompute. They are drawn from the session rather than from this
   * step's in-memory analysis, so the cohort figures see every video, not only
   * the one on screen.
   */
  function renderFigures(): void {
    const figuresProps: ReviewFiguresProps = {
      session: store.current,
      videoId: currentVideo()?.id ?? null,
      problems: analysisProblems(),
    };
    if (figures) {
      figures.update(figuresProps);
      return;
    }
    figures = createReviewFigures(figuresHost, figuresProps, {
      onAnnounce: context.announce,
      onGoToTrack: () => context.showStep('track'),
    });
  }

  function renderExport(): void {
    if (exporter) {
      exporter.update();
      return;
    }
    exporter = createReviewExport(exportHost, store, context.toolVersion, {
      onAnnounce: context.announce,
      runQuietly: <T,>(work: () => T): T => {
        sweeping = true;
        try {
          return work();
        } finally {
          sweeping = false;
        }
      },
    });
  }

  function renderPanels(): void {
    const video = currentVideo();
    renderNoEscape();
    const parametersProps: ParametersPanelProps = {
      parameters: store.parameters,
      previous: video ? (previousByVideo.get(video.id) ?? null) : null,
      next: analysis,
    };
    if (parametersComponent) {
      parametersComponent.update(parametersProps);
    } else {
      replaceChildren(parametersPanel, []);
      parametersComponent = createParametersPanel(parametersPanel, parametersProps, {
        onParametersChange,
        onAnnounce: (message) => {
          context.announce(pendingReflow ? `${message} ${pendingReflow}` : message);
          pendingReflow = '';
        },
      });
    }

    if (!analysis || !video) {
      metricsComponent?.destroy();
      eventsComponent?.destroy();
      qualityComponent?.destroy();
      metricsComponent = null;
      eventsComponent = null;
      qualityComponent = null;
      for (const panel of [metricsPanel, eventsPanel, qualityPanel]) {
        replaceChildren(panel, [el('p', { class: 'hint', text: 'No analysis yet.' })]);
      }
      return;
    }

    const metricsProps: MetricsCardProps = {
      analysis,
      parameters: store.parameters,
      strategyOverrideId: strategyOverride(currentLayer() ?? NO_CORRECTIONS)?.id ?? null,
      noEscapeReason: noEscapeCorrection(currentLayer() ?? NO_CORRECTIONS)?.reason ?? null,
    };
    if (metricsComponent) {
      metricsComponent.update(metricsProps);
    } else {
      replaceChildren(metricsPanel, []);
      metricsComponent = createMetricsCard(metricsPanel, metricsProps, strategyCallbacks);
    }

    const eventsProps: EventListProps = { events: analysis.events, flags: analysis.reviewFlags };
    if (eventsComponent) {
      eventsComponent.update(eventsProps);
    } else {
      replaceChildren(eventsPanel, []);
      eventsComponent = createEventList(eventsPanel, eventsProps, seekCallbacks);
    }

    const qualityProps: QualityPanelProps = { session: store.current, videoId: video.id, analysis };
    if (qualityComponent) {
      qualityComponent.update(qualityProps);
    } else {
      replaceChildren(qualityPanel, []);
      qualityComponent = createQualityPanel(qualityPanel, qualityProps, seekCallbacks);
    }
  }


  // ---- helpers ------------------------------------------------------------------------------

  function syncSelect(select: HTMLSelectElement, options: { value: string; label: string }[], value: string): void {
    const same =
      select.options.length === options.length &&
      options.every((o, i) => select.options[i]!.value === o.value && select.options[i]!.textContent === o.label);
    if (!same) replaceChildren(select, options.map((o) => el('option', { text: o.label, attrs: { value: o.value } })));
    if (document.activeElement !== select) select.value = value;
  }

  // The app shell calls `refresh` on every store change; no second subscription here.
  return {
    id: 'review',
    label: 'Review & Export',
    what:
      'Check every event against the frames it came from, correct what the tracker got wrong, and read the metrics. ' +
      'Every correction is stored beside the automatic values and everything is recomputed from both.',
    definitions: () => [
      el('ul', {}, [
        el('li', { text: 'Automatic values are never overwritten: a correction is a separate entry, everything downstream is recomputed, and "revert to automatic" is one action per item.' }),
        el('li', { text: 'A filled marker is automatic; a diamond with a "user" badge was placed by hand; a hollow dashed marker was filled by the cleaning step. Corrected events are hatched and tagged "user".' }),
        el('li', { text: 'Times come from each frame’s own timestamp in the file, never from a nominal frame rate.' }),
        el('li', { text: 'Every threshold and metric shows its definition beside its control.' }),
        el('li', { text: 'An event is to check when a review flag names it, or it was decided over frames the tracker was unsure of. Correcting it takes it off the list.' }),
      ]),
    ],
    body,
    blocked: () => {
      if (store.videos.length === 0) return 'no videos are loaded yet — start on the Videos step';
      if (store.current.mazeMap === null) return 'the maze is not finished — mark the platform and enter its diameter on the Maze step';
      if (!store.videos.some((v) => store.analysisFor(v.id) !== undefined)) return 'no video has been tracked yet — run the Track step';
      return null;
    },
    // The last step, and the one whose work is never "finished" by a rule: the
    // queue above the timeline says how much is left, and only a person can say
    // the review is over.
    done: () => false,
    refresh: render,
    onShow: () => {
      render();
      canvasView.fit();
      seek(playhead, false);
    },
  };
}
