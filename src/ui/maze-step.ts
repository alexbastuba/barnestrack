/**
 * Step 2 — Maze. Platform circle, parametric hole ring, target hole,
 * calibration, and map reuse across the cohort. D10, D13, D14, D15, D29, D44,
 * O8.
 *
 * The session holds one shared map — the physical maze — and a similarity
 * transform per video. Everything that identifies a hole (phase, target,
 * per-hole nudges) is edited in *map* coordinates, so hole 7 is hole 7 in every
 * video; where the platform sits on screen is edited as that video's transform.
 * A click on the image is therefore mapped back through the inverse transform
 * before it changes anything.
 */
import {
  MAZE_MAP_SCHEMA_VERSION,
  type MazeMapFile,
  type PlatformCircle,
  type SimilarityTransform,
} from '../contracts/mazeMap.js';
import type { VideoDescriptor } from '../contracts/session.js';
import { fitCircle } from '../maze/circle-fit.js';
import {
  applyHandleDrag,
  HANDLE_KINDS,
  HANDLE_NAMES,
  handlePositions,
  hitTestHandle,
  MIN_PLATFORM_RADIUS_PX,
  nudgeHandle,
  RING_RATIO_MAX,
  RING_RATIO_MIN,
  type HandleGeometry,
  type HandleKind,
} from '../maze/handles.js';
import {
  DEFAULT_HOLE_COUNT,
  DEFAULT_HOLE_DIAMETER_CM,
  DEFAULT_RING_RATIO,
  holeCentres,
  holeDiameterCm,
  holeRadiusPx,
  nearestHole,
  pxPerCm,
  ringRadius,
  ringRotationForClick,
  targetClickOutcome,
  TYPICAL_PLATFORM_DIAMETER_CM,
} from '../maze/ring.js';
import {
  IDENTITY_TRANSFORM,
  composeTransform,
  invertTransform,
  transformForResolution,
  rotationAbout,
  transformFromCircles,
  transformMap,
  transformVector,
} from '../maze/similarity.js';
import { angleDifferenceDeg, type Point } from '../maze/types.js';
import { videoToViewport, type ViewTransform } from '../maze/view-transform.js';
import { mazeMapFileName, parseMazeMapDocument } from '../session/maze-map-file.js';
import type { VideoId } from '../session/stored.js';
import { CanvasView } from './canvas-view.js';
import { Scrubber } from './scrubber.js';
import { button, el, replaceChildren, scrollRegion, uniqueId } from './dom.js';
import { createNextStepButton, mazeMissing, mazeSetCount } from './next-step.js';
import { downloadText, pickFiles } from './download.js';
import { drawHandle, HANDLE_HIT_PX } from './maze-handles.js';
import { drawHole, drawLabel } from './overlay-draw.js';
import type { AppContext, Step } from './step.js';

type Mode = 'idle' | 'rim' | 'align' | 'target' | 'adjust';
/** What the arrow keys move: one of the maze's handles, or one hole. */
type Selection = { kind: 'handle'; handle: HandleKind } | { kind: 'hole'; holeIndex: number } | null;

/**
 * A drag in progress (D69). The geometry is previewed here and nothing reaches
 * the store until the release: every store write re-derives the cohort, which
 * is too slow to do per pointer move, and a cancelled gesture then has nothing
 * to undo. `from` is the press point and `base` the geometry under it, so each
 * move is computed from the start rather than accumulated.
 */
interface HandleDrag {
  handle: HandleKind;
  from: Point;
  base: HandleGeometry;
  preview: HandleGeometry;
  /** True once the pointer has left the dead zone; only a moved drag commits and counts. */
  moved: boolean;
  /** The pending redraw, so a fast pointer costs one render per frame. */
  frame: number;
}

/** The handle buttons' order: the whole maze first, then the two edges from the outside in. */
const HANDLE_BUTTON_ORDER: readonly HandleKind[] = ['centre', 'platformRim', 'ringRim'];

const RIM_POINTS_NEEDED = 3;
/** How near a click must be to a hole, in screen-independent pixels, to select it. */
const HOLE_PICK_SLACK_PX = 12;
/** A hole is picked within this multiple of its own radius. */
const HOLE_PICK_FACTOR = 1.5;
/**
 * A fitted platform larger than this multiple of the frame's diagonal is not a
 * platform: three nearly collinear rim clicks fit an enormous circle whose
 * radius looks reasonable to a `min`/`max` check but makes px/cm nonsense
 * (D14, D44). Refuse it and say why, as with exactly collinear points.
 */
const MAX_PLATFORM_RADIUS_FACTOR = 1.5;
const NUDGE_PX = 1;
const NUDGE_PX_LARGE = 10;

const MODE_PROMPT: Record<Mode, string> = {
  idle: 'Drag a handle on the image, pick an action from the controls, or use the numeric fields.',
  rim: 'Click 3 points on the platform edge.',
  align: 'Click one hole to align the ring.',
  target: 'Click the target hole, or type its number.',
  adjust: 'Click 3 points on this video’s platform edge to refit the shared map.',
};

export function createMazeStep(context: AppContext): Step {
  const { store } = context;

  let selectedVideoId: VideoId | null = null;
  let mode: Mode = 'idle';
  let rimPoints: Point[] = [];
  let selection: Selection = null;
  let hoverPoint: Point | null = null;
  let hoverHandle: HandleKind | null = null;
  let drag: HandleDrag | null = null;
  let seekToken = 0;
  let typedHoleDiameterCm = DEFAULT_HOLE_DIAMETER_CM;
  /**
   * Has anyone named the target hole for this map? A new map is born with
   * `target.holeIndex: 0` because the contract has no "no target" state, so the
   * first click must be able to name the number rather than turn the ring
   * (D49). A map that arrives from a file or a loaded session already carries a
   * chosen target, so it starts true — see `render`, `adoptMapDocument` and
   * `setPlatformInVideo`.
   */
  let targetChosen = store.workingMazeMap !== null;

  const body = el('div', { class: 'maze-step' });

  // ---- derived state --------------------------------------------------------

  function currentVideo(): VideoDescriptor | null {
    const videos = store.videos;
    const chosen = videos.find((v) => v.id === selectedVideoId);
    if (chosen) return chosen;
    return videos.find((v) => store.isAttached(v.id)) ?? videos[0] ?? null;
  }

  function sharedMap(): MazeMapFile | null {
    return store.workingMazeMap;
  }

  /** A map is finished only once the one calibration input is in (D14, D44, D47). */
  function calibrated(): boolean {
    return store.current.mazeMap !== null;
  }

  /**
   * The shared map expressed in the current video's pixels. While a handle is
   * being dragged this is the previewed geometry, built by the same maths the
   * release will commit, so what is drawn, tabulated and shown in the fields
   * is exactly what will land.
   */
  function videoMap(): MazeMapFile | null {
    const map = sharedMap();
    const video = currentVideo();
    if (!map || !video) return null;
    if (drag?.moved) {
      if (drag.handle === 'ringRim') {
        return transformMap(
          { ...map, holes: { ...map.holes, ringRatio: drag.preview.ringRatio } },
          video.mazeTransform,
          video.referenceResolution,
        );
      }
      const placed = placementFor(video, map, drag.preview.platform);
      if (placed) return transformMap(map, placed, video.referenceResolution);
    }
    return transformMap(map, video.mazeTransform, video.referenceResolution);
  }

  function toMapVector(videoVector: Point): Point | null {
    const video = currentVideo();
    if (!video) return null;
    return transformVector(invertTransform(video.mazeTransform), videoVector);
  }

  /** This video's px/cm, derived from the map after its transform (D44). */
  function videoPxPerCm(): number | null {
    const map = videoMap();
    if (!map) return null;
    return pxPerCm(map.platform, map.calibration.platformDiameter_cm);
  }

  /**
   * The hole diameter in centimetres. It is derived from `holeRadius_px`, which
   * cannot be computed before the platform diameter is known — so a value typed
   * first is remembered here and applied the moment the calibration lands (O8).
   */
  function currentHoleDiameterCm(): number {
    const map = sharedMap();
    if (!map) return typedHoleDiameterCm;
    const scale = pxPerCm(map.platform, map.calibration.platformDiameter_cm);
    if (scale === null || map.holes.holeRadius_px <= 0) return typedHoleDiameterCm;
    return holeDiameterCm(map.holes.holeRadius_px, scale);
  }

  /**
   * "Maze set on N of M videos." — the bar's status line once the step is
   * finished (D72), and the tail of every announcement of an action that can
   * change the count, so a screen reader hears where the cohort stands the
   * moment it moves. Null while there is no cohort. Per-video confirmation is
   * session state and is not built here, so the count is of videos the map
   * has been placed in, not of videos anyone has signed off.
   */
  function progressText(): string | null {
    const total = store.videos.length;
    if (total === 0) return null;
    return `Maze set on ${mazeSetCount(store)} of ${total} video${total === 1 ? '' : 's'}.`;
  }

  /** `message` with the cohort's progress after it, for an action that can change the count. */
  function withProgress(message: string): string {
    const progress = progressText();
    return progress === null ? message : `${message} ${progress}`;
  }

  // ---- edits ----------------------------------------------------------------

  function countClick(): void {
    const video = currentVideo();
    if (video) store.countMazeClick(video.id);
  }

  function updateMap(change: (map: MazeMapFile) => MazeMapFile): void {
    const map = sharedMap();
    if (!map) return;
    store.setMazeMap(change(map));
  }

  /** Keeps `holeRadius_px` consistent with the calibration; both live in map pixels. */
  function withHoleRadius(map: MazeMapFile, holeDiameter_cm: number): MazeMapFile {
    const scale = pxPerCm(map.platform, map.calibration.platformDiameter_cm);
    return {
      ...map,
      holes: { ...map.holes, holeRadius_px: scale === null ? 0 : holeRadiusPx(holeDiameter_cm, scale) },
    };
  }

  /** Places the platform in *this video's* pixels, creating the shared map the first time. */
  function setPlatformInVideo(circle: PlatformCircle): void {
    const video = currentVideo();
    if (!video) return;
    const existing = sharedMap();
    if (!existing) {
      store.setMazeTransform(video.id, IDENTITY_TRANSFORM);
      store.setMazeMap({
        schemaVersion: MAZE_MAP_SCHEMA_VERSION,
        referenceResolution: video.referenceResolution,
        platform: circle,
        holes: {
          n: DEFAULT_HOLE_COUNT,
          ringRatio: DEFAULT_RING_RATIO,
          holeRadius_px: 0,
          phase_deg: 0,
        },
        target: { holeIndex: 0 },
        calibration: { platformDiameter_cm: 0 },
        createdFrom: video.id,
      });
      // The `target: 0` above is the contract's placeholder, not a choice: the
      // next target click names the shared number instead of turning the ring.
      targetChosen = false;
      context.announce(
        withProgress(
          `Platform set: centre ${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}, radius ${circle.r.toFixed(1)} px. Twenty holes generated. Enter the platform diameter to finish.`,
        ),
      );
      return;
    }
    const placed = placementFor(video, existing, circle);
    if (!placed) return;
    store.setMazeTransform(video.id, placed);
    context.announce(
      withProgress(
        `Platform for ${video.filename}: centre ${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}, radius ${circle.r.toFixed(1)} px.`,
      ),
    );
  }

  /**
   * This video's transform once the shared map's platform lands on `circle`
   * (in this video's pixels). A circle carries no orientation, so re-fitting
   * it would drop the ring alignment this video already has; the fit is spun
   * back about the new centre. Used by the typed fields, the rim clicks and
   * the handles alike, and by the drag preview, so all of them agree.
   */
  function placementFor(
    video: VideoDescriptor,
    shared: MazeMapFile,
    circle: PlatformCircle,
  ): SimilarityTransform | null {
    const placed = transformFromCircles(shared.platform, circle);
    if (!placed) return null;
    return composeTransform(
      rotationAbout(video.mazeTransform.rotationDeg, { x: circle.cx, y: circle.cy }),
      placed,
    );
  }

  /** Is this circle a platform in this frame, or the artefact of three near-collinear clicks? */
  function plausiblePlatform(circle: PlatformCircle): boolean {
    const video = currentVideo();
    if (!video) return false;
    const diagonal = Math.hypot(video.referenceResolution.width, video.referenceResolution.height);
    return circle.r > 0 && circle.r <= diagonal * MAX_PLATFORM_RADIUS_FACTOR;
  }

  function onPick(videoPoint: Point): void {
    const map = videoMap();
    if (mode === 'rim' || mode === 'adjust') {
      rimPoints = [...rimPoints, videoPoint];
      countClick();
      if (rimPoints.length >= RIM_POINTS_NEEDED) {
        const circle = fitCircle(rimPoints);
        rimPoints = [];
        mode = 'idle';
        if (!circle || !plausiblePlatform(circle)) {
          context.announce(
            'Those three points are too nearly in a straight line to name a circle. Try again with points spread around the rim — near the top, the side and the bottom.',
          );
        } else {
          setPlatformInVideo(circle);
        }
      } else {
        context.announce(`${rimPoints.length} of ${RIM_POINTS_NEEDED} rim points.`);
      }
      render();
      return;
    }
    if (!map) {
      context.announce('Mark the platform first: choose "Click 3 points on the platform edge".');
      return;
    }
    if (mode === 'align') {
      const turn = ringRotationForClick(map, videoPoint);
      countClick();
      mode = 'idle';
      if (turn === null) {
        context.announce('That click is at the platform centre, which does not name an angle. Click on a hole.');
      } else {
        rotateRing(turn);
      }
      render();
      return;
    }
    if (mode === 'target') {
      const found = nearestHole(map, videoPoint);
      countClick();
      mode = 'idle';
      if (found) claimTarget(found.hole.holeIndex);
      render();
      return;
    }
    // Idle: a click selects whatever it landed on, for the arrow keys. A press
    // on a handle never gets here — `onDragStart` claims it first.
    const found = nearestHole(map, videoPoint);
    const pickRadius = Math.max(map.holes.holeRadius_px, HOLE_PICK_SLACK_PX) * HOLE_PICK_FACTOR;
    if (found && found.distance_px <= pickRadius) {
      selection = { kind: 'hole', holeIndex: found.hole.holeIndex };
      context.announce(`Hole ${found.hole.holeIndex} selected. Arrow keys nudge it; hold Shift for 10 pixels.`);
    } else {
      selectHandle('centre');
    }
    render();
  }

  // ---- handles (D69) --------------------------------------------------------

  /** The handle under `point`, if any; handles only answer while no click action is armed. */
  function handleAt(point: Point): HandleKind | null {
    const map = videoMap();
    if (!map || mode !== 'idle') return null;
    return hitTestHandle(
      point,
      handlePositions(map.platform, map.holes),
      // A screen-constant target: the tolerance is in CSS pixels whatever the zoom (D15).
      HANDLE_HIT_PX / canvasView.currentView.zoom,
    );
  }

  function selectionMessage(handle: HandleKind): string {
    const how = `${HANDLE_NAMES[handle]} selected — drag it, or use the arrow keys; hold Shift for 10 pixels.`;
    return handle === 'ringRim' ? `${how} The ring ratio applies to every video in this session.` : how;
  }

  function selectHandle(handle: HandleKind, announce = true): void {
    selection = { kind: 'handle', handle };
    if (announce) context.announce(selectionMessage(handle));
  }

  function sameGeometry(a: HandleGeometry, b: HandleGeometry): boolean {
    return (
      a.platform.cx === b.platform.cx &&
      a.platform.cy === b.platform.cy &&
      a.platform.r === b.platform.r &&
      a.ringRatio === b.ringRatio
    );
  }

  /** The label drawn beside a handle; the ring's says what else it changes when it has the user's attention. */
  function handleLabel(handle: HandleKind, emphasised: boolean): string {
    const name = HANDLE_NAMES[handle].toLowerCase();
    return handle === 'ringRim' && emphasised ? `${name} — applies to every video in this session` : name;
  }

  function onDragStart(point: Point): boolean {
    const map = videoMap();
    const handle = handleAt(point);
    if (!map || !handle) return false;
    // Announced on release, not here: a message of a different height reflows
    // the page, and the frame must not move under a pointer that is holding it.
    selectHandle(handle, false);
    const base = { platform: map.platform, ringRatio: map.holes.ringRatio };
    drag = { handle, from: point, base, preview: base, moved: false, frame: 0 };
    render();
    return true;
  }

  function onDrag(point: Point): void {
    if (!drag) return;
    drag.moved = true;
    drag.preview = applyHandleDrag(drag.handle, drag.from, point, drag.base.platform, drag.base);
    if (drag.frame === 0) {
      drag.frame = requestAnimationFrame(() => {
        if (drag) drag.frame = 0;
        render();
      });
    }
  }

  function onDragEnd(point: Point): void {
    if (!drag) return;
    const ended = drag;
    if (ended.frame !== 0) cancelAnimationFrame(ended.frame);
    drag = null;
    const result = ended.moved
      ? applyHandleDrag(ended.handle, ended.from, point, ended.base.platform, ended.base)
      : ended.base;
    if (sameGeometry(result, ended.base)) {
      // A press that only selected, or a drag that came back to where it
      // started: nothing was placed, so nothing is written or counted.
      context.announce(selectionMessage(ended.handle));
    } else {
      commitHandle(ended.handle, result);
      // One drag is one placement on the image, however many moves it took (D50).
      countClick();
    }
    render();
  }

  /** The browser took the pointer away: nothing was released, so nothing lands. */
  function onDragCancel(): void {
    if (!drag) return;
    if (drag.frame !== 0) cancelAnimationFrame(drag.frame);
    drag = null;
    render();
  }

  /**
   * The one place a handle's result reaches the session, and it is the same
   * place the typed fields go (D49): the centre and the platform edge place the
   * platform in *this video's* transform through `setPlatformInVideo`; the ring
   * edge writes the shared map's `ringRatio`, which every video reads.
   */
  function commitHandle(handle: HandleKind, result: HandleGeometry): void {
    if (handle === 'ringRim') {
      updateMap((m) => ({ ...m, holes: { ...m.holes, ringRatio: result.ringRatio } }));
      context.announce(
        `Ring radius ÷ platform radius is now ${result.ringRatio.toFixed(3)}; it applies to every video in this session.`,
      );
      return;
    }
    setPlatformInVideo(result.platform);
  }

  /**
   * Names the target hole from a click (D49).
   *
   * The target *number* belongs to the shared map and to the whole cohort; which
   * physical hole carries it in this video belongs to this video's transform,
   * because the platform is turned between trials. So the first click names the
   * shared number and every later one on a different hole turns this video's
   * ring by whole holes until that number lands where the user clicked — the
   * other videos keep the numbering they already have.
   */
  function claimTarget(holeIndex: number): void {
    const shared = sharedMap();
    const video = currentVideo();
    if (!shared || !video) return;
    const outcome = targetClickOutcome(
      shared.holes.n,
      targetChosen ? shared.target.holeIndex : null,
      holeIndex,
    );
    if (outcome.kind === 'set') {
      setTargetIndex(outcome.holeIndex);
      context.announce(`Hole ${outcome.holeIndex} is the target hole.`);
      return;
    }
    if (outcome.kind === 'unchanged') {
      context.announce(`Hole ${holeIndex} is already the target hole in ${video.filename}.`);
      selection = { kind: 'hole', holeIndex };
      return;
    }
    turnRing(outcome.degrees);
    selection = { kind: 'hole', holeIndex: shared.target.holeIndex };
    const holes = Math.abs(outcome.holes);
    // Turning the ring renumbers every hole in this video, and an event
    // correction names its event by an id carrying the old hole number (A3), so
    // say so rather than let the corrections quietly become orphans.
    const corrections = store.analysisFor(video.id)?.corrections.entries.filter((e) => e.kind === 'event').length ?? 0;
    const warning =
      corrections > 0
        ? ` ${corrections} event correction${corrections === 1 ? '' : 's'} on this video name holes by their old numbers and will be listed as no longer matching — check them on the Review step.`
        : '';
    context.announce(
      `Hole numbers in ${video.filename} now count from this hole as the target (turned ${holes} hole${holes === 1 ? '' : 's'}); other videos are unchanged.${warning}`,
    );
  }

  /** The one place the shared target number is written; both the click and the field use it. */
  function setTargetIndex(holeIndex: number): void {
    updateMap((m) => ({ ...m, target: { holeIndex } }));
    targetChosen = true;
    selection = { kind: 'hole', holeIndex };
  }

  /**
   * Turns the hole ring in *this* video only, by rotating its transform about
   * its own platform centre. The shared `phase_deg` is never written after the
   * map is created: it identifies holes for the whole cohort, so aligning the
   * ring on a second video must not move the first one's (D10, D28, D49).
   */
  function turnRing(degrees: number): void {
    const video = currentVideo();
    const map = videoMap();
    if (!video || !map || degrees === 0) return;
    store.setMazeTransform(
      video.id,
      composeTransform(
        rotationAbout(degrees, { x: map.platform.cx, y: map.platform.cy }),
        video.mazeTransform,
      ),
    );
  }

  /** `turnRing` with the alignment click's own announcement. */
  function rotateRing(degrees: number): void {
    const video = currentVideo();
    if (!video || degrees === 0) return;
    turnRing(degrees);
    const after = videoMap();
    context.announce(
      `Ring aligned on ${video.filename}: hole 0 is now at ${(after?.holes.phase_deg ?? 0).toFixed(1)}° in this video. Other videos are unchanged.`,
    );
  }

  function nudge(dx: number, dy: number): void {
    const map = videoMap();
    if (!selection || !map || drag) return;
    if (selection.kind === 'handle') {
      const result = nudgeHandle(selection.handle, dx, dy, map.platform, map.holes);
      if (sameGeometry(result, { platform: map.platform, ringRatio: map.holes.ringRatio })) {
        context.announce(`${HANDLE_NAMES[selection.handle]} is at its limit.`);
      } else {
        commitHandle(selection.handle, result);
      }
      render();
      return;
    }
    const delta = toMapVector({ x: dx, y: dy });
    if (!delta) return;
    const holeIndex = selection.holeIndex;
    updateMap((m) => {
      const offsets = [...(m.holes.offsets ?? [])];
      const at = offsets.findIndex((o) => o.holeIndex === holeIndex);
      const current = at >= 0 ? offsets[at]! : { holeIndex, dx_px: 0, dy_px: 0 };
      const next = { holeIndex, dx_px: current.dx_px + delta.x, dy_px: current.dy_px + delta.y };
      if (at >= 0) offsets[at] = next;
      else offsets.push(next);
      return { ...m, holes: { ...m.holes, offsets } };
    });
    context.announce(`Hole ${holeIndex} nudged by ${dx}, ${dy} pixels.`);
    render();
  }

  /**
   * The keyboard equivalent of the rim clicks: typing any of centre x, centre y
   * or radius creates the platform if there is not one yet, starting from a
   * circle inscribed in the frame, and the remaining fields fill in with it.
   */
  function resizePlatform(change: Partial<PlatformCircle>): void {
    const video = currentVideo();
    if (!video) return;
    const base = videoMap()?.platform ?? {
      cx: video.referenceResolution.width / 2,
      cy: video.referenceResolution.height / 2,
      r: Math.min(video.referenceResolution.width, video.referenceResolution.height) * 0.4,
    };
    setPlatformInVideo({ ...base, ...change });
    render();
  }

  // ---- reuse (D10, D29) -----------------------------------------------------

  /**
   * Exports what this video shows, not the raw shared map: the user means "this
   * maze, in these pixels". Only a calibrated map is exportable, so an
   * uncalibrated one cannot travel to another machine looking finished.
   */
  function exportMap(): void {
    const map = videoMap();
    if (!map || !calibrated()) return;
    downloadText(mazeMapFileName(), `${JSON.stringify(map, null, 2)}\n`);
    context.announce(`Maze map saved as ${mazeMapFileName()}.`);
  }

  async function importMap(): Promise<void> {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    const problem = adoptMapDocument(await file.text());
    context.announce(
      problem ??
        withProgress(
          `Maze map loaded from ${file.name} and scaled onto every video in this session. Check each one and use "Adjust" where the platform sits differently.`,
        ),
    );
    render();
  }

  /** Returns a plain-language problem, or null when the map was adopted. */
  function adoptMapDocument(text: string): string | null {
    const parsed = parseMazeMapDocument(text);
    if (!parsed.ok) return parsed.message;
    const map = parsed.map;
    store.setMazeMap(map);
    // Every video's transform was fitted against the platform of the map that
    // has just been replaced, so every one of them is now meaningless.
    for (const video of store.videos) {
      store.setMazeTransform(
        video.id,
        transformForResolution(map.referenceResolution, video.referenceResolution),
      );
    }
    selection = null;
    drag = null;
    mode = 'idle';
    rimPoints = [];
    // An imported map carries the target its author chose.
    targetChosen = true;
    return null;
  }

  function applyMapFrom(sourceId: VideoId): void {
    const source = store.videoById(sourceId);
    const target = currentVideo();
    const map = sharedMap();
    if (!source || !target || !map) return;
    store.setMazeTransform(
      target.id,
      composeTransform(
        transformForResolution(source.referenceResolution, target.referenceResolution),
        source.mazeTransform,
      ),
    );
    mode = 'idle';
    rimPoints = [];
    context.announce(
      withProgress(
        `Maze map applied from ${source.filename}. If the platform sits differently in this video, choose "Adjust" and click 3 rim points.`,
      ),
    );
    render();
  }

  // ---- overlay --------------------------------------------------------------

  function paint(ctx: CanvasRenderingContext2D, view: ViewTransform): void {
    const map = videoMap();
    const at = (p: Point) => videoToViewport(p, view);

    for (const [i, point] of rimPoints.entries()) {
      const p = at(point);
      ctx.strokeStyle = '#0a4d8c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x - 7, p.y);
      ctx.lineTo(p.x + 7, p.y);
      ctx.moveTo(p.x, p.y - 7);
      ctx.lineTo(p.x, p.y + 7);
      ctx.stroke();
      drawLabel(ctx, `rim ${i + 1}`, p.x + 9, p.y - 9);
    }

    if (map) {
      const centre = at({ x: map.platform.cx, y: map.platform.cy });
      const radius = map.platform.r * view.zoom;
      const selectedHandle = selection?.kind === 'handle' ? selection.handle : null;

      ctx.strokeStyle = '#0a4d8c';
      ctx.lineWidth = selectedHandle === 'centre' || selectedHandle === 'platformRim' ? 4 : 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#4a5159';
      ctx.lineWidth = selectedHandle === 'ringRim' ? 2 : 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, ringRadius(map.platform, map.holes) * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const holeRadius = Math.max(map.holes.holeRadius_px * view.zoom, 3);
      for (const hole of holeCentres(map)) {
        drawHole(ctx, at(hole), holeRadius, hole.holeIndex, {
          isTarget: hole.holeIndex === map.target.holeIndex,
          selected: selection?.kind === 'hole' && selection.holeIndex === hole.holeIndex,
          sized: map.holes.holeRadius_px > 0,
          labelSuffix: hole.nudged ? '*' : '',
        });
      }

      // The handles go on last, over the holes they may sit near (D69).
      const positions = handlePositions(map.platform, map.holes);
      for (const kind of HANDLE_KINDS) {
        const isSelected = selectedHandle === kind;
        const isHovered = hoverHandle === kind;
        drawHandle(ctx, at(positions[kind]), kind, {
          selected: isSelected,
          hovered: isHovered,
          label: handleLabel(kind, isSelected || isHovered),
        });
      }
    }

    drawLabel(ctx, clickText(), 8, 8, true);
    if (hoverPoint && mode !== 'idle') {
      drawLabel(ctx, MODE_PROMPT[mode], 8, 30, true);
    }
  }

  // ---- controls -------------------------------------------------------------

  const canvasView = new CanvasView({
    label:
      'Video frame with the maze overlay. Drag the centre, platform-edge or ring-edge handle to place the maze. The table below repeats everything drawn here.',
    paint,
    onPick,
    onDragStart,
    onDrag,
    onDragEnd,
    onDragCancel,
    onHover: (p) => {
      hoverPoint = p;
      const over = p && !drag ? handleAt(p) : null;
      if (over !== hoverHandle) {
        hoverHandle = over;
        canvasView.viewport.classList.toggle('is-over-handle', over !== null);
        canvasView.requestDraw();
      }
    },
    announce: context.announce,
  });

  /** "N clicks on the image": the badge and the overlay say the same thing (D50). */
  function clickText(): string {
    const video = currentVideo();
    const clicks = video ? store.mazeClickCount(video.id) : 0;
    return `${clicks} click${clicks === 1 ? '' : 's'} on the image`;
  }

  canvasView.viewport.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && selection && !drag) {
      event.preventDefault();
      selection = null;
      context.announce('Nothing selected.');
      render();
      return;
    }
    if (event.altKey || !event.key.startsWith('Arrow') || !selection) return;
    const step = event.shiftKey ? NUDGE_PX_LARGE : NUDGE_PX;
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (dx === 0 && dy === 0) return;
    event.preventDefault();
    nudge(dx, dy);
  });


  const scrubber = new Scrubber({
    onSeek: (frameIndex) => void showFrame(frameIndex),
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

  // ---- control widgets ------------------------------------------------------

  /**
   * A number field that cannot put a value into the maze map that the map
   * cannot mean. `min`/`max` on the element are advisory — the browser will
   * hand you −3 holes if the user types it — so the value is clamped (and
   * rounded to whole numbers when the step is one) before it is committed,
   * and the user is told when that happened.
   */
  function numberField(
    label: string,
    config: { step?: string; min?: string; max?: string; hint?: string; live?: boolean },
    onCommit: (value: number) => void,
  ): { wrap: HTMLElement; input: HTMLInputElement } {
    const input = el('input', { id: uniqueId('maze'), class: 'number-input' });
    input.type = 'number';
    input.step = config.step ?? '1';
    if (config.min !== undefined) input.min = config.min;
    if (config.max !== undefined) input.max = config.max;
    /*
     * A `live` field redraws as it is typed. `change` alone fires on blur, so
     * the overlay only caught up when the user clicked somewhere else — which
     * is what a hole diameter typed against a picture of a maze needs least.
     * Only a value already inside the bounds commits here: clamping and its
     * announcement stay on `change`, so typing "1" on the way to "12" is not
     * snapped to the minimum under the user's hands.
     */
    if (config.live === true) {
      input.addEventListener('input', () => {
        const typed = Number(input.value);
        if (input.value.trim() === '' || !Number.isFinite(typed)) return;
        const low = config.min === undefined ? -Infinity : Number(config.min);
        const high = config.max === undefined ? Infinity : Number(config.max);
        if (typed < low || typed > high) return;
        onCommit(typed);
      });
    }
    input.addEventListener('change', () => {
      const typed = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(typed)) {
        context.announce(`${label} needs a number.`);
        render();
        return;
      }
      const low = config.min === undefined ? -Infinity : Number(config.min);
      const high = config.max === undefined ? Infinity : Number(config.max);
      const whole = input.step === '1' ? Math.round(typed) : typed;
      const value = Math.min(high, Math.max(low, whole));
      onCommit(value);
      if (value !== typed) {
        // `render` leaves a focused field alone, which is right while the user
        // types and wrong here: the number on screen must be the one stored.
        input.value = String(value);
        // Announced after the commit, so the explanation is the message left
        // standing rather than the one the field's own announcement replaced.
        context.announce(
          `${label} must be ${describeRange(low, high, input.step === '1')}, so ${typed} became ${value}.`,
        );
      }
    });
    const hint = config.hint === undefined ? null : el('span', { class: 'hint', text: config.hint });
    if (hint) {
      hint.id = `${input.id}-hint`;
      input.setAttribute('aria-describedby', hint.id);
    }
    return {
      wrap: el('div', { class: 'field' }, [
        el('label', { text: label, attrs: { for: input.id } }),
        input,
        hint,
      ]),
      input,
    };
  }

  function describeRange(low: number, high: number, whole: boolean): string {
    const unit = whole ? 'a whole number' : 'a number';
    if (low > -Infinity && high < Infinity) return `${unit} from ${low} to ${high}`;
    if (low > -Infinity) return `${unit} of at least ${low}`;
    if (high < Infinity) return `${unit} of at most ${high}`;
    return unit;
  }

  function modeButton(target: Mode, text: string): HTMLButtonElement {
    const control = button(text, () => {
      mode = mode === target ? 'idle' : target;
      rimPoints = [];
      context.announce(mode === 'idle' ? 'Action cancelled.' : MODE_PROMPT[mode]);
      render();
    }, { class: 'btn-quiet' });
    control.dataset['mode'] = target;
    return control;
  }

  function nudgePad(label: string): HTMLElement {
    const key = (text: string, name: string, dx: number, dy: number) =>
      button(text, () => nudge(dx * nudgeStep(), dy * nudgeStep()), {
        class: 'btn-quiet nudge',
        attrs: { 'aria-label': name },
      });
    return el('div', { class: 'nudge-pad', attrs: { role: 'group', 'aria-label': label } }, [
      key('←', 'Nudge left', -1, 0),
      key('↑', 'Nudge up', 0, -1),
      key('↓', 'Nudge down', 0, 1),
      key('→', 'Nudge right', 1, 0),
      bigStepToggle,
    ]);
  }

  const bigStepToggle = el('label', { class: 'big-step' }, []);
  const bigStepInput = el('input', { id: 'maze-big-step' });
  bigStepInput.type = 'checkbox';
  bigStepToggle.append(bigStepInput, document.createTextNode(' 10 px steps'));
  bigStepToggle.setAttribute('for', bigStepInput.id);
  function nudgeStep(): number {
    return bigStepInput.checked ? NUDGE_PX_LARGE : NUDGE_PX;
  }

  const videoSelect = el('select', { id: 'maze-video' });
  videoSelect.addEventListener('change', () => {
    selectedVideoId = videoSelect.value;
    mode = 'idle';
    rimPoints = [];
    selection = null;
    drag = null;
    const video = currentVideo();
    const attachment = video ? store.attachmentFor(video.id) : undefined;
    scrubber.setIndex(attachment?.index ?? null);
    void showFrame(scrubber.frameIndex);
    context.announce(`Maze step now showing ${video?.filename ?? 'no video'}.`);
    render();
  });

  const rimButton = modeButton('rim', 'Click 3 points on the platform edge');
  const alignButton = modeButton('align', 'Click one hole to align the ring');
  const targetButton = modeButton('target', 'Click the target hole');
  const adjustButton = modeButton('adjust', 'Adjust: click 3 rim points');

  const cxField = numberField('Centre x (px)', { step: '0.1', min: '-10000', max: '10000' }, (v) =>
    resizePlatform({ cx: v }),
  );
  const cyField = numberField('Centre y (px)', { step: '0.1', min: '-10000', max: '10000' }, (v) =>
    resizePlatform({ cy: v }),
  );
  const rField = numberField(
    'Radius (px)',
    {
      step: '0.1',
      // The same floor as the platform-edge handle, so the two never disagree.
      min: String(MIN_PLATFORM_RADIUS_PX),
      max: '10000',
      hint: 'Typing any of these three creates the platform without clicking the rim.',
    },
    (v) => resizePlatform({ r: v }),
  );

  // The keyboard's way to a handle (D37): press one, and the frame has focus
  // with that handle under the arrow keys, as the old "select the platform"
  // button did for the whole circle.
  const handleButtons = HANDLE_BUTTON_ORDER.map((kind) => {
    const control = button(HANDLE_NAMES[kind], () => {
      if (selection?.kind === 'handle' && selection.handle === kind) {
        // A pressed toggle pressed again lets go, as its aria-pressed promises.
        selection = null;
        context.announce('Nothing selected.');
      } else {
        selectHandle(kind);
        canvasView.viewport.focus({ preventScroll: true });
      }
      render();
    }, { class: 'btn-quiet' });
    control.dataset['handle'] = kind;
    return control;
  });
  const handleGroup = el(
    'div',
    { class: 'handle-group', attrs: { role: 'group', 'aria-label': 'Select a handle for the arrow keys' } },
    [el('span', { text: 'Arrow keys move' }), ...handleButtons],
  );

  const holeCountField = numberField('Holes', { min: '3', max: '60', hint: 'Default 20.' }, (v) => {
    const n = Math.round(v);
    const before = sharedMap();
    updateMap((m) => ({
      ...m,
      holes: {
        ...m.holes,
        n,
        // A nudge or a target naming a hole that no longer exists is a map the
        // contract cannot mean, and it would reach the session file (D10).
        ...(m.holes.offsets ? { offsets: m.holes.offsets.filter((o) => o.holeIndex < n) } : {}),
      },
      target: { holeIndex: Math.min(m.target.holeIndex, n - 1) },
    }));
    const after = sharedMap();
    if (before && after && before.target.holeIndex !== after.target.holeIndex) {
      context.announce(
        `Ring set to ${n} holes, so the target moved from hole ${before.target.holeIndex} to hole ${after.target.holeIndex}.`,
      );
    }
    if (selection?.kind === 'hole' && selection.holeIndex >= n) selection = null;
    render();
  });
  const ringRatioField = numberField(
    'Ring radius ÷ platform radius',
    // 0.005: a 0.01 step moved the ring further than the tolerance a user is
    // trying to close when the holes are nearly on it. The bounds are the ring
    // handle's too.
    {
      step: '0.005',
      min: String(RING_RATIO_MIN),
      max: String(RING_RATIO_MAX),
      hint: 'Default 0.89. Applies to every video in this session.',
    },
    (v) => updateMap((m) => ({ ...m, holes: { ...m.holes, ringRatio: v } })),
  );
  const holeDiameterField = numberField(
    'Hole diameter (cm)',
    { step: '0.1', min: '0.1', max: '100', hint: 'Default 5 cm.', live: true },
    (v) => {
      typedHoleDiameterCm = v;
      updateMap((m) => withHoleRadius(m, v));
      if (!calibrated()) {
        context.announce(
          `Hole diameter noted as ${v} cm. The hole size is drawn once the platform diameter is entered.`,
        );
      }
      render();
    },
  );
  const phaseField = numberField(
    'Ring angle of hole 0 (°)',
    { step: '0.1', min: '-360', max: '360', hint: 'The angle in this video; other videos keep theirs.' },
    (v) => {
      const map = videoMap();
      if (!map) return;
      rotateRing(angleDifferenceDeg(v, map.holes.phase_deg));
      render();
    },
  );
  const targetField = numberField(
    'Target hole number',
    {
      min: '0',
      hint: 'The shared number, the same in every video; which physical hole carries it is per video. Clicking a hole turns this video’s ring instead, so the number keeps its meaning.',
    },
    (v) => {
      const map = sharedMap();
      if (!map) return;
      const holeIndex = Math.max(0, Math.min(map.holes.n - 1, Math.round(v)));
      setTargetIndex(holeIndex);
      context.announce(`Hole ${holeIndex} is the target hole in every video.`);
      render();
    },
  );
  const nudgeHoleField = numberField('Hole to nudge', { min: '0', max: '999' }, (v) => {
    const map = sharedMap();
    if (!map) return;
    selection = { kind: 'hole', holeIndex: Math.min(map.holes.n - 1, Math.round(v)) };
    context.announce(
      `Hole ${selection.holeIndex} selected. Press Enter here, or Tab to the frame, then use the arrow keys; hold Shift for 10 pixels.`,
    );
    render();
  });
  // `change` also fires on blur, so moving focus there would yank a keyboard
  // user out of the tab order. Enter is the deliberate "take me to the frame".
  nudgeHoleField.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    nudgeHoleField.input.dispatchEvent(new Event('change'));
    canvasView.viewport.focus({ preventScroll: true });
  });
  const resetNudges = button('Reset nudges', () => {
    updateMap((m) => ({ ...m, holes: { ...m.holes, offsets: [] } }));
    context.announce('Every hole is back on the generated ring.');
    render();
  }, { class: 'btn-quiet' });

  const diameterField = numberField(
    'Platform diameter (cm)',
    {
      step: '0.1',
      min: '10',
      max: '1000',
      hint: `Required. A typical mouse Barnes maze is about ${TYPICAL_PLATFORM_DIAMETER_CM} cm across.`,
    },
    (v) => {
      updateMap((m) => withHoleRadius({ ...m, calibration: { platformDiameter_cm: v } }, currentHoleDiameterCm()));
      context.announce(`Platform diameter set to ${v} cm.`);
      render();
    },
  );
  const scaleReadout = el('p', { class: 'scale-readout' });

  const exportButton = button('Export map', exportMap, { class: 'btn-secondary' });
  const importButton = button('Import map', () => void importMap(), { class: 'btn-secondary' });
  const applySelect = el('select', { id: 'maze-apply-from' });
  const applyButton = button('Apply map from this video', () => applyMapFrom(applySelect.value), {
    class: 'btn-secondary',
  });

  const modeStatus = el('p', { class: 'mode-status' });
  const nextStep = createNextStepButton(context, 'track', 'Track');
  // A status chip, not a button: it reports, it is not pressed (D70).
  const clickBadge = el('p', { class: 'status-chip', attrs: { 'aria-live': 'off' } });
  const mirrorBody = el('tbody');
  const mirrorSummary = el('p', { class: 'mirror-summary' });

  const controls = el('div', { class: 'maze-controls' }, [
    fieldset('Platform', [
      rimButton,
      el('div', { class: 'field-row' }, [cxField.wrap, cyField.wrap, rField.wrap]),
      el('div', { class: 'field-row' }, [handleGroup, nudgePad('Nudge the selected handle or hole')]),
    ]),
    fieldset('Hole ring', [
      el('div', { class: 'field-row' }, [holeCountField.wrap, ringRatioField.wrap, holeDiameterField.wrap]),
      el('div', { class: 'field-row' }, [alignButton, phaseField.wrap]),
      el('div', { class: 'field-row' }, [nudgeHoleField.wrap, resetNudges]),
    ]),
    fieldset('Target', [el('div', { class: 'field-row' }, [targetButton, targetField.wrap])]),
    fieldset('Calibration', [el('div', { class: 'field-row' }, [diameterField.wrap]), scaleReadout]),
    fieldset('Reuse this map', [
      el('div', { class: 'field-row' }, [
        exportButton,
        importButton,
        el('div', { class: 'field' }, [
          el('label', { text: 'Apply from', attrs: { for: 'maze-apply-from' } }),
          applySelect,
        ]),
        applyButton,
        adjustButton,
      ]),
      el('p', {
        class: 'hint',
        text: 'The map is shared by the whole session: hole 7 is hole 7 in every video. Applying it to another video only says where the same maze sits in that video’s pixels.',
      }),
    ]),
  ]);

  function fieldset(legend: string, children: HTMLElement[]): HTMLElement {
    const node = el('fieldset', { class: 'maze-fieldset' });
    node.append(el('legend', { text: legend }));
    for (const child of children) node.append(child);
    return node;
  }

  const mirror = el('section', { class: 'mirror' }, [
    el('h3', { text: 'What the overlay is drawing' }),
    mirrorSummary,
    scrollRegion('Every hole in this video’s pixels', [
      // `has-num`: text cells read left, and only the two coordinates right-align on their figures.
      el('table', { class: 'mirror-table has-num' }, [
        el('caption', {
          text: 'Every hole in this video’s pixels. An asterisk in "Nudged" marks a hole moved off the generated ring.',
        }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Hole', attrs: { scope: 'col' } }),
            el('th', { text: 'x (px)', class: 'num', attrs: { scope: 'col' } }),
            el('th', { text: 'y (px)', class: 'num', attrs: { scope: 'col' } }),
            el('th', { text: 'Nudged', attrs: { scope: 'col' } }),
            el('th', { text: 'Target', attrs: { scope: 'col' } }),
          ]),
        ]),
        mirrorBody,
      ]),
    ]),
  ]);

  // The stage (D69): the selector and the chip, the prompt and the scrubber,
  // the frame, the controls. In source order they stack; from 1200 px the
  // stylesheet lays them in two rows of two — the prompt and the scrubber
  // beside the selector, the frame beside the scrolling controls — so the
  // frame and the Platform fieldset start on the same line and every control
  // is on screen with the frame. The step's status line lives in the action
  // bar after the mirror, which stays the last thing in the step (D72).
  body.append(
    el('div', { class: 'maze-stage' }, [
      el('div', { class: 'maze-stage-top' }, [
        el('div', { class: 'maze-top' }, [
          el('div', { class: 'field' }, [
            el('label', { text: 'Video', attrs: { for: 'maze-video' } }),
            videoSelect,
          ]),
          clickBadge,
        ]),
      ]),
      el('div', { class: 'maze-stage-head' }, [modeStatus, scrubber.element]),
      el('div', { class: 'maze-stage-view' }, [canvasView.element]),
      controls,
    ]),
    mirror,
    nextStep.element,
  );

  // ---- render ---------------------------------------------------------------

  let lastVideoId: VideoId | null = null;
  let lastAttached = false;
  let lastEpoch = store.epoch;

  function render(): void {
    const missing = mazeMissing(store);
    nextStep.update(missing);
    // The bar's status line (D72): while the step is unfinished it is the
    // button's reason, which carries the count; once every video is set it
    // says how far the cohort is, so the line never goes blank while there is
    // one. The line is not a live region — the count is spoken by the action
    // that changes it, through `withProgress`.
    const progress = missing === null ? progressText() : null;
    if (progress !== null) {
      nextStep.bar.status.textContent = progress;
      nextStep.bar.status.hidden = false;
    }
    if (store.epoch !== lastEpoch) {
      // Load, reset or restore replaced the whole session: nothing cached here
      // refers to it any more.
      lastEpoch = store.epoch;
      lastVideoId = null;
      lastAttached = false;
      selectedVideoId = null;
      selection = null;
      drag = null;
      mode = 'idle';
      rimPoints = [];
      // A map that came with the session has a target somebody chose (D49).
      targetChosen = store.workingMazeMap !== null;
    }
    const video = currentVideo();
    const map = videoMap();
    const shared = sharedMap();

    syncSelect(videoSelect, store.videos.map((v) => ({ value: v.id, label: labelFor(v) })), video?.id ?? '');
    syncSelect(
      applySelect,
      store.videos.filter((v) => v.id !== video?.id).map((v) => ({ value: v.id, label: v.filename })),
      applySelect.value,
    );

    // A video is added to the session a moment before its file is attached, so
    // the frame source has to be picked up on the attachment change too.
    const isAttached = video !== null && store.isAttached(video.id);
    if (video && (video.id !== lastVideoId || isAttached !== lastAttached)) {
      lastVideoId = video.id;
      lastAttached = isAttached;
      const attachment = store.attachmentFor(video.id);
      scrubber.setIndex(attachment?.index ?? null);
      if (attachment) {
        canvasView.setVideoSize(attachment.index.width, attachment.index.height);
        void showFrame(scrubber.frameIndex);
      } else {
        canvasView.setVideoSize(video.referenceResolution.width, video.referenceResolution.height);
        canvasView.setFrame(null);
      }
    }

    for (const control of [rimButton, alignButton, targetButton, adjustButton]) {
      const isActive = control.dataset['mode'] === mode;
      control.classList.toggle('is-active', isActive);
      control.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
    adjustButton.disabled = shared === null;
    exportButton.disabled = !calibrated();
    // A field that silently does nothing is worse than one that is plainly not
    // available yet: everything below needs a platform to change.
    for (const control of [
      holeCountField.input,
      ringRatioField.input,
      holeDiameterField.input,
      phaseField.input,
      targetField.input,
      nudgeHoleField.input,
      diameterField.input,
      resetNudges,
      ...handleButtons,
    ]) {
      control.disabled = shared === null;
    }
    for (const control of handleButtons) {
      const isPressed = selection?.kind === 'handle' && selection.handle === control.dataset['handle'];
      control.classList.toggle('is-active', isPressed);
      control.setAttribute('aria-pressed', isPressed ? 'true' : 'false');
    }
    applyButton.disabled = shared === null || applySelect.options.length === 0;
    alignButton.disabled = shared === null;
    targetButton.disabled = shared === null;

    // Which physical hole carries the shared target number in *this* video: the
    // number is the cohort's, the ring angle is this video's (D49).
    const targetHere =
      shared && map ? ` · target: hole ${shared.target.holeIndex}, ring at ${map.holes.phase_deg.toFixed(1)}°` : '';
    modeStatus.textContent = video
      ? isAttached
        ? `${MODE_PROMPT[mode]}${targetHere}`
        : `${video.filename} is not attached, so no frame can be shown. Drop the file again on the Videos step; the numeric fields below still work.${targetHere}`
      : 'Load a video on the Videos step first.';

    clickBadge.textContent = clickText();

    setNumber(cxField.input, map?.platform.cx, 1);
    setNumber(cyField.input, map?.platform.cy, 1);
    setNumber(rField.input, map?.platform.r, 1);
    setNumber(holeCountField.input, shared?.holes.n);
    // From the effective map, so a ring-edge drag's preview reaches the field
    // live; outside a drag the transform leaves the ratio as the shared map has it.
    setNumber(ringRatioField.input, (map ?? shared)?.holes.ringRatio, 3);
    setNumber(holeDiameterField.input, shared ? currentHoleDiameterCm() : undefined, 2);
    // The effective map, not the shared one: the ring turns per video, so the
    // shared phase stays where the map was created and would read 0 forever.
    setNumber(phaseField.input, map?.holes.phase_deg, 2);
    setNumber(targetField.input, shared?.target.holeIndex);
    setNumber(nudgeHoleField.input, selection?.kind === 'hole' ? selection.holeIndex : undefined);
    setNumber(diameterField.input, shared && shared.calibration.platformDiameter_cm > 0 ? shared.calibration.platformDiameter_cm : undefined, 2);
    if (shared) {
      targetField.input.max = String(shared.holes.n - 1);
      nudgeHoleField.input.max = String(shared.holes.n - 1);
    }

    const scale = videoPxPerCm();
    scaleReadout.textContent =
      scale === null
        ? 'Scale: not yet known. Enter the platform diameter — nothing downstream is computed until it is set.'
        : `Scale: ${scale.toFixed(3)} px/cm in this video (2 × ${map!.platform.r.toFixed(1)} px ÷ ${map!.calibration.platformDiameter_cm} cm).`;
    scaleReadout.classList.toggle('is-missing', scale === null);

    renderMirror(map);
    canvasView.requestDraw();
  }

  function renderMirror(map: MazeMapFile | null): void {
    if (!map) {
      mirrorSummary.textContent = 'No maze yet. Mark the platform to generate the hole ring.';
      replaceChildren(mirrorBody, []);
      return;
    }
    const scale = videoPxPerCm();
    mirrorSummary.textContent =
      `Platform centre ${map.platform.cx.toFixed(1)}, ${map.platform.cy.toFixed(1)} px; radius ${map.platform.r.toFixed(1)} px. ` +
      `${map.holes.n} holes at ${(map.holes.ringRatio * 100).toFixed(0)} % of the platform radius, hole 0 at ${map.holes.phase_deg.toFixed(1)}°. ` +
      `Target hole ${map.target.holeIndex}. ` +
      (scale === null ? 'Scale not set.' : `Scale ${scale.toFixed(3)} px/cm; hole radius ${map.holes.holeRadius_px.toFixed(1)} px.`);

    replaceChildren(
      mirrorBody,
      holeCentres(map).map((hole) =>
        el('tr', { class: hole.holeIndex === map.target.holeIndex ? 'is-target' : '' }, [
          el('th', { text: String(hole.holeIndex), attrs: { scope: 'row' } }),
          el('td', { class: 'num', text: hole.x.toFixed(1) }),
          el('td', { class: 'num', text: hole.y.toFixed(1) }),
          el('td', { text: hole.nudged ? 'yes' : 'no' }),
          el('td', { text: hole.holeIndex === map.target.holeIndex ? 'target' : '' }),
        ]),
      ),
    );
  }

  function labelFor(video: VideoDescriptor): string {
    return store.isAttached(video.id) ? video.filename : `${video.filename} (not attached)`;
  }

  function syncSelect(
    select: HTMLSelectElement,
    options: { value: string; label: string }[],
    value: string,
  ): void {
    const same =
      select.options.length === options.length &&
      options.every((option, i) => select.options[i]?.value === option.value && select.options[i]?.text === option.label);
    if (!same) {
      replaceChildren(
        select,
        options.map((option) => {
          const node = el('option', { text: option.label });
          node.value = option.value;
          return node;
        }),
      );
    }
    if (options.some((option) => option.value === value)) select.value = value;
    else if (options[0]) select.value = options[0].value;
  }

  function setNumber(input: HTMLInputElement, value: number | undefined, decimals = 0): void {
    if (document.activeElement === input) return;
    input.value = value === undefined || !Number.isFinite(value) ? '' : value.toFixed(decimals);
  }

  return {
    id: 'maze',
    label: 'Maze',
    what:
      'Place the platform by dragging its handles, by clicking three rim points or by typing the ' +
      'numbers; generate the hole ring, name the target hole and enter the platform diameter. The ' +
      'map belongs to the whole session, so hole 7 means the same hole in every video; a second ' +
      'video only needs to say where that maze sits in its own frame.',
    definitions: () => [
      el('dl', { class: 'definition-list' }, [
        el('dt', { text: 'Platform circle' }),
        el('dd', {
          text:
            'Dragged into place by its handles — the centre moves the whole maze, the platform ' +
            'edge resizes it and the ring edge sets the hole ring’s radius for every video — or a ' +
            'least-squares circle through the rim points you click (three is enough), or typed ' +
            'centre and radius. Stored in native video pixels, so zoom and pan never change it.',
        }),
        el('dt', { text: 'Hole ring' }),
        el('dd', {
          text:
            `Holes are generated, not clicked: a count (default ${DEFAULT_HOLE_COUNT}), a ring radius as a ` +
            `fraction of the platform radius (default ${DEFAULT_RING_RATIO}) and one angle. Clicking any hole sets ` +
            'that angle so the whole ring lines up. A single hole can be nudged when a maze is ' +
            'genuinely irregular; nudged holes are marked with an asterisk.',
        }),
        el('dt', { text: 'Target hole' }),
        el('dd', {
          text:
            'The escape hole. It is drawn with a double ring and the label "T", not by colour alone, ' +
            'and it is listed in the table below.',
        }),
        el('dt', { text: 'Calibration' }),
        el('dd', {
          text:
            'The platform diameter in centimetres is the one measurement BarnesTrack needs from you. ' +
            'Every distance threshold is stored in centimetres and converted per video from it, so ' +
            'nothing downstream is computed until it is entered.',
        }),
        el('dt', { text: 'Reusing the map' }),
        el('dd', {
          text:
            'One map is shared by the session. "Apply from" places it in another video by scaling for ' +
            'resolution; "Adjust" refits it from three rim clicks by translation and scale, keeping ' +
            'the ring angle, the target and any nudges.',
        }),
        el('dt', { text: 'Keyboard' }),
        el('dd', {
          text:
            'Every mouse action has a typed equivalent: centre and radius fields instead of rim clicks ' +
            'or handle drags, the ring-angle field instead of the alignment click, the target-hole ' +
            'number instead of the target click. The Centre, Platform edge and Ring edge buttons put ' +
            'that handle under the arrow keys. Tab to the frame, then arrow keys nudge the current ' +
            'selection by 1 px (10 px with Shift) and Escape clears it; + and − zoom, 0 fits, Alt ' +
            'with the arrow keys pans. The scroll wheel zooms ' +
            'only with Ctrl or ⌘, so a plain scroll still moves the page. On the scrubber: arrow ' +
            'keys move 1 frame, Shift with them 10 frames, Home and End jump to the ends.',
        }),
      ]),
    ],
    body,
    blocked: () =>
      store.videos.length === 0 ? 'load at least one video on the Videos step first' : null,
    done: () => mazeMissing(store) === null,
    doneLabel: () => 'maze set',
    refresh: render,
    onShow: () => {
      canvasView.fit();
      void showFrame(scrubber.frameIndex);
    },
  };
}
