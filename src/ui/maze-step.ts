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
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile, type PlatformCircle } from '../contracts/mazeMap.js';
import type { VideoDescriptor } from '../contracts/session.js';
import { fitCircle } from '../maze/circle-fit.js';
import {
  DEFAULT_HOLE_COUNT,
  DEFAULT_HOLE_DIAMETER_CM,
  DEFAULT_RING_RATIO,
  holeCentres,
  holeDiameterCm,
  holeRadiusPx,
  nearestHole,
  phaseForClick,
  pxPerCm,
  ringRadius,
  TYPICAL_PLATFORM_DIAMETER_CM,
  type HolePosition,
} from '../maze/ring.js';
import {
  applyTransform,
  IDENTITY_TRANSFORM,
  composeTransform,
  invertTransform,
  transformForResolution,
  transformFromCircles,
  transformMap,
  transformVector,
} from '../maze/similarity.js';
import type { Point } from '../maze/types.js';
import { videoToViewport, type ViewTransform } from '../maze/view-transform.js';
import type { VideoId } from '../session/stored.js';
import { CanvasView } from './canvas-view.js';
import { Scrubber } from './scrubber.js';
import { button, el, replaceChildren, uniqueId } from './dom.js';
import { downloadText, pickFiles } from './download.js';
import type { AppContext, Step } from './step.js';

type Mode = 'idle' | 'rim' | 'align' | 'target' | 'adjust';
type Selection = { kind: 'platform' } | { kind: 'hole'; holeIndex: number } | null;

const RIM_POINTS_NEEDED = 3;
const NUDGE_PX = 1;
const NUDGE_PX_LARGE = 10;

const MODE_PROMPT: Record<Mode, string> = {
  idle: 'Pick an action below, or use the numeric fields.',
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
  let seekToken = 0;

  const body = el('div', { class: 'maze-step' });

  // ---- derived state --------------------------------------------------------

  function currentVideo(): VideoDescriptor | null {
    const videos = store.videos;
    const chosen = videos.find((v) => v.id === selectedVideoId);
    if (chosen) return chosen;
    return videos.find((v) => store.isAttached(v.id)) ?? videos[0] ?? null;
  }

  function sharedMap(): MazeMapFile | null {
    return store.current.mazeMap;
  }

  /** The shared map expressed in the current video's pixels. */
  function videoMap(): MazeMapFile | null {
    const map = sharedMap();
    const video = currentVideo();
    if (!map || !video) return null;
    return transformMap(map, video.mazeTransform, video.referenceResolution);
  }

  function toMapPoint(videoPoint: Point): Point | null {
    const video = currentVideo();
    if (!video) return null;
    return applyTransform(invertTransform(video.mazeTransform), videoPoint);
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

  function currentHoleDiameterCm(): number {
    const map = sharedMap();
    if (!map) return DEFAULT_HOLE_DIAMETER_CM;
    const scale = pxPerCm(map.platform, map.calibration.platformDiameter_cm);
    if (scale === null || map.holes.holeRadius_px <= 0) return DEFAULT_HOLE_DIAMETER_CM;
    return holeDiameterCm(map.holes.holeRadius_px, scale);
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
      context.announce(
        `Platform set: centre ${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}, radius ${circle.r.toFixed(1)} px. Twenty holes generated. Enter the platform diameter to finish.`,
      );
      return;
    }
    const transform = transformFromCircles(existing.platform, circle);
    if (!transform) return;
    store.setMazeTransform(video.id, transform);
    context.announce(
      `Platform for ${video.filename}: centre ${circle.cx.toFixed(1)}, ${circle.cy.toFixed(1)}, radius ${circle.r.toFixed(1)} px.`,
    );
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
        if (!circle) {
          context.announce('Those three points lie on a straight line, so no circle passes through them. Try again with points spread around the rim.');
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
      const mapPoint = toMapPoint(videoPoint);
      const shared = sharedMap();
      if (!mapPoint || !shared) return;
      const phase = phaseForClick(shared, mapPoint);
      countClick();
      mode = 'idle';
      if (phase === null) {
        context.announce('That click is at the platform centre, which does not name an angle. Click on a hole.');
      } else {
        updateMap((m) => ({ ...m, holes: { ...m.holes, phase_deg: phase } }));
        context.announce(`Ring aligned: hole 0 is now at ${phase.toFixed(1)}°.`);
      }
      render();
      return;
    }
    if (mode === 'target') {
      const mapPoint = toMapPoint(videoPoint);
      const shared = sharedMap();
      if (!mapPoint || !shared) return;
      const found = nearestHole(shared, mapPoint);
      countClick();
      mode = 'idle';
      if (found) {
        updateMap((m) => ({ ...m, target: { holeIndex: found.hole.holeIndex } }));
        selection = { kind: 'hole', holeIndex: found.hole.holeIndex };
        context.announce(`Hole ${found.hole.holeIndex} is the target hole.`);
      }
      render();
      return;
    }
    // Idle: a click selects whatever it landed on, for the arrow keys.
    const found = nearestHole(map, videoPoint);
    if (found && found.distance_px <= Math.max(map.holes.holeRadius_px, 12) * 1.5) {
      selection = { kind: 'hole', holeIndex: found.hole.holeIndex };
      context.announce(`Hole ${found.hole.holeIndex} selected. Arrow keys nudge it; hold Shift for 10 pixels.`);
    } else {
      selection = { kind: 'platform' };
      context.announce('Platform selected. Arrow keys nudge the circle; hold Shift for 10 pixels.');
    }
    render();
  }

  function nudge(dx: number, dy: number): void {
    const map = videoMap();
    if (!selection || !map) return;
    if (selection.kind === 'platform') {
      setPlatformInVideo({ cx: map.platform.cx + dx, cy: map.platform.cy + dy, r: map.platform.r });
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

  function exportMap(): void {
    const map = sharedMap();
    if (!map) return;
    downloadText('maze-map.barnestrack.json', `${JSON.stringify(map, null, 2)}\n`);
    context.announce('Maze map saved as maze-map.barnestrack.json.');
  }

  async function importMap(): Promise<void> {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    const problem = adoptMapDocument(await file.text());
    context.announce(problem ?? `Maze map loaded from ${file.name}.`);
    render();
  }

  /** Returns a plain-language problem, or null when the map was adopted. */
  function adoptMapDocument(text: string): string | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return 'That file is not valid JSON, so it cannot be a maze map.';
    }
    const map = parsed as Partial<MazeMapFile>;
    if (typeof map?.schemaVersion !== 'number') return 'That file is not a BarnesTrack maze map.';
    if (map.schemaVersion !== MAZE_MAP_SCHEMA_VERSION) {
      return `That maze map uses schema version ${map.schemaVersion}; this build reads version ${MAZE_MAP_SCHEMA_VERSION}.`;
    }
    if (!map.platform || !map.holes || !map.target || !map.calibration || !map.referenceResolution) {
      return 'That maze map is missing its platform, holes, target or calibration.';
    }
    const video = currentVideo();
    store.setMazeMap(map as MazeMapFile);
    if (video) {
      store.setMazeTransform(
        video.id,
        transformForResolution(map.referenceResolution, video.referenceResolution),
      );
    }
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
      `Maze map applied from ${source.filename}. If the platform sits differently in this video, choose "Adjust" and click 3 rim points.`,
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

      ctx.strokeStyle = '#0a4d8c';
      ctx.lineWidth = selection?.kind === 'platform' ? 4 : 2;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, radius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = '#4a5159';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, ringRadius(map.platform, map.holes) * view.zoom, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const holeRadius = Math.max(map.holes.holeRadius_px * view.zoom, 3);
      for (const hole of holeCentres(map)) {
        drawHole(ctx, at(hole), holeRadius, hole, map.target.holeIndex, selection, map.holes.holeRadius_px > 0);
      }
    }

    drawLabel(
      ctx,
      `Maze step: ${currentVideo() ? store.mazeClickCount(currentVideo()!.id) : 0} clicks on the image`,
      8,
      8,
      true,
    );
    if (hoverPoint && mode !== 'idle') {
      drawLabel(ctx, MODE_PROMPT[mode], 8, 30, true);
    }
  }

  function drawHole(
    ctx: CanvasRenderingContext2D,
    p: Point,
    radius: number,
    hole: HolePosition,
    targetIndex: number,
    current: Selection,
    sized: boolean,
  ): void {
    const isTarget = hole.holeIndex === targetIndex;
    const isSelected = current?.kind === 'hole' && current.holeIndex === hole.holeIndex;

    ctx.strokeStyle = isTarget ? '#9a2417' : '#16191d';
    ctx.lineWidth = isTarget ? 3 : 1.5;
    ctx.setLineDash(sized ? [] : [3, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (isTarget) {
      // Shape, not colour: the target carries a second ring and a "T" label (D26).
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius + 4, 0, Math.PI * 2);
      ctx.stroke();
      drawLabel(ctx, `T${hole.holeIndex} target`, p.x + radius + 7, p.y - 8);
    } else {
      drawLabel(ctx, hole.nudged ? `${hole.holeIndex}*` : String(hole.holeIndex), p.x + radius + 3, p.y - 8);
    }

    if (isSelected) {
      // Corner brackets: distinguishable from the target ring without colour.
      const s = radius + 7;
      ctx.strokeStyle = '#0a4d8c';
      ctx.lineWidth = 2;
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        ctx.beginPath();
        ctx.moveTo(p.x + sx * s, p.y + sy * s - sy * 6);
        ctx.lineTo(p.x + sx * s, p.y + sy * s);
        ctx.lineTo(p.x + sx * s - sx * 6, p.y + sy * s);
        ctx.stroke();
      }
    }
  }

  function drawLabel(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    strong = false,
  ): void {
    ctx.font = `${strong ? '600 ' : ''}12px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const width = ctx.measureText(text).width;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fillRect(x - 2, y - 1, width + 4, 15);
    ctx.fillStyle = '#16191d';
    ctx.fillText(text, x, y);
  }

  // ---- controls -------------------------------------------------------------

  const canvasView = new CanvasView({
    label: 'Video frame with the maze overlay. The table below repeats everything drawn here.',
    paint,
    onPick,
    onHover: (p) => {
      hoverPoint = p;
    },
    announce: context.announce,
  });

  canvasView.viewport.addEventListener('keydown', (event) => {
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

  function numberField(
    label: string,
    config: { step?: string; min?: string; max?: string; hint?: string },
    onCommit: (value: number) => void,
  ): { wrap: HTMLElement; input: HTMLInputElement } {
    const input = el('input', { id: uniqueId('maze'), class: 'number-input' });
    input.type = 'number';
    input.step = config.step ?? '1';
    if (config.min !== undefined) input.min = config.min;
    if (config.max !== undefined) input.max = config.max;
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) onCommit(value);
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

  function modeButton(target: Mode, text: string): HTMLButtonElement {
    const control = button(text, () => {
      mode = mode === target ? 'idle' : target;
      rimPoints = [];
      context.announce(mode === 'idle' ? 'Action cancelled.' : MODE_PROMPT[mode]);
      render();
    });
    control.dataset['mode'] = target;
    return control;
  }

  function nudgePad(label: string): HTMLElement {
    const key = (text: string, dx: number, dy: number) =>
      button(text, () => nudge(dx * nudgeStep(), dy * nudgeStep()), { class: 'nudge' });
    return el('div', { class: 'nudge-pad', attrs: { role: 'group', 'aria-label': label } }, [
      key('←', -1, 0),
      key('↑', 0, -1),
      key('↓', 0, 1),
      key('→', 1, 0),
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

  const cxField = numberField('Centre x (px)', { step: '0.1' }, (v) => resizePlatform({ cx: v }));
  const cyField = numberField('Centre y (px)', { step: '0.1' }, (v) => resizePlatform({ cy: v }));
  const rField = numberField(
    'Radius (px)',
    { step: '0.1', min: '1', hint: 'Typing any of these three creates the platform without clicking the rim.' },
    (v) => resizePlatform({ r: v }),
  );

  const selectPlatform = button('Select the platform for the arrow keys', () => {
    selection = { kind: 'platform' };
    canvasView.viewport.focus({ preventScroll: true });
    context.announce('Platform selected. Arrow keys nudge it; hold Shift for 10 pixels.');
    render();
  });

  const holeCountField = numberField('Holes', { min: '3', max: '60', hint: 'Default 20 (O8).' }, (v) =>
    updateMap((m) => ({ ...m, holes: { ...m.holes, n: Math.round(v) } })),
  );
  const ringRatioField = numberField(
    'Ring radius ÷ platform radius',
    { step: '0.01', min: '0.1', max: '1', hint: 'Default 0.89 (O8).' },
    (v) => updateMap((m) => ({ ...m, holes: { ...m.holes, ringRatio: v } })),
  );
  const holeDiameterField = numberField(
    'Hole diameter (cm)',
    { step: '0.1', min: '0.1', hint: 'Default 5 cm (O8).' },
    (v) => updateMap((m) => withHoleRadius(m, v)),
  );
  const phaseField = numberField('Ring angle of hole 0 (°)', { step: '0.1' }, (v) =>
    updateMap((m) => ({ ...m, holes: { ...m.holes, phase_deg: v } })),
  );
  const targetField = numberField('Target hole number', { min: '0' }, (v) => {
    const map = sharedMap();
    if (!map) return;
    const holeIndex = Math.max(0, Math.min(map.holes.n - 1, Math.round(v)));
    updateMap((m) => ({ ...m, target: { holeIndex } }));
    selection = { kind: 'hole', holeIndex };
    context.announce(`Hole ${holeIndex} is the target hole.`);
    render();
  });
  const nudgeHoleField = numberField('Hole to nudge', { min: '0' }, (v) => {
    const map = sharedMap();
    if (!map) return;
    const holeIndex = Math.max(0, Math.min(map.holes.n - 1, Math.round(v)));
    selection = { kind: 'hole', holeIndex };
    canvasView.viewport.focus({ preventScroll: true });
    context.announce(`Hole ${holeIndex} selected. Arrow keys nudge it; hold Shift for 10 pixels.`);
    render();
  });
  const resetNudges = button('Reset nudges', () => {
    updateMap((m) => ({ ...m, holes: { ...m.holes, offsets: [] } }));
    context.announce('Every hole is back on the generated ring.');
    render();
  });

  const diameterField = numberField(
    'Platform diameter (cm)',
    { step: '0.1', min: '1', hint: `Required. A typical mouse Barnes maze is about ${TYPICAL_PLATFORM_DIAMETER_CM} cm across.` },
    (v) => {
      updateMap((m) => withHoleRadius({ ...m, calibration: { platformDiameter_cm: v } }, currentHoleDiameterCm()));
      context.announce(`Platform diameter set to ${v} cm.`);
      render();
    },
  );
  const scaleReadout = el('p', { class: 'scale-readout' });

  const exportButton = button('Export map', exportMap);
  const importButton = button('Import map', () => void importMap());
  const applySelect = el('select', { id: 'maze-apply-from' });
  const applyButton = button('Apply map from this video', () => applyMapFrom(applySelect.value));

  const modeStatus = el('p', { class: 'mode-status' });
  const clickBadge = el('p', { class: 'click-badge', attrs: { 'aria-live': 'off' } });
  const mirrorBody = el('tbody');
  const mirrorSummary = el('p', { class: 'mirror-summary' });

  const controls = el('div', { class: 'maze-controls' }, [
    fieldset('Platform', [
      rimButton,
      el('div', { class: 'field-row' }, [cxField.wrap, cyField.wrap, rField.wrap]),
      el('div', { class: 'field-row' }, [selectPlatform, nudgePad('Nudge the platform or the selected hole')]),
    ]),
    fieldset('Hole ring', [
      el('div', { class: 'field-row' }, [holeCountField.wrap, ringRatioField.wrap, holeDiameterField.wrap]),
      el('div', { class: 'field-row' }, [alignButton, phaseField.wrap]),
      el('div', { class: 'field-row' }, [targetButton, targetField.wrap]),
      el('div', { class: 'field-row' }, [nudgeHoleField.wrap, resetNudges]),
    ]),
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
    el('div', { class: 'table-scroll' }, [
      el('table', { class: 'mirror-table' }, [
        el('caption', {
          text: 'Every hole in this video’s pixels. An asterisk in "Nudged" marks a hole moved off the generated ring.',
        }),
        el('thead', {}, [
          el('tr', {}, [
            el('th', { text: 'Hole', attrs: { scope: 'col' } }),
            el('th', { text: 'x (px)', attrs: { scope: 'col' } }),
            el('th', { text: 'y (px)', attrs: { scope: 'col' } }),
            el('th', { text: 'Nudged', attrs: { scope: 'col' } }),
            el('th', { text: 'Target', attrs: { scope: 'col' } }),
          ]),
        ]),
        mirrorBody,
      ]),
    ]),
  ]);

  body.append(
    el('div', { class: 'maze-top' }, [
      el('div', { class: 'field' }, [
        el('label', { text: 'Video', attrs: { for: 'maze-video' } }),
        videoSelect,
      ]),
      clickBadge,
    ]),
    modeStatus,
    scrubber.element,
    canvasView.element,
    controls,
    mirror,
  );

  // ---- render ---------------------------------------------------------------

  let lastVideoId: VideoId | null = null;
  let lastAttached = false;

  function render(): void {
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
    exportButton.disabled = shared === null;
    applyButton.disabled = shared === null || applySelect.options.length === 0;
    alignButton.disabled = shared === null;
    targetButton.disabled = shared === null;

    modeStatus.textContent = video
      ? isAttached
        ? MODE_PROMPT[mode]
        : `${video.filename} is not attached, so no frame can be shown. Drop the file again on the Videos step; the numeric fields below still work.`
      : 'Load a video on the Videos step first.';

    clickBadge.textContent = `Maze step: ${video ? store.mazeClickCount(video.id) : 0} clicks on the image`;

    setNumber(cxField.input, map?.platform.cx, 1);
    setNumber(cyField.input, map?.platform.cy, 1);
    setNumber(rField.input, map?.platform.r, 1);
    setNumber(holeCountField.input, shared?.holes.n);
    setNumber(ringRatioField.input, shared?.holes.ringRatio, 3);
    setNumber(holeDiameterField.input, shared ? currentHoleDiameterCm() : undefined, 2);
    setNumber(phaseField.input, shared?.holes.phase_deg, 2);
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
          el('td', { text: hole.x.toFixed(1) }),
          el('td', { text: hole.y.toFixed(1) }),
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
      'Mark the platform, generate the hole ring, name the target hole and enter the platform ' +
      'diameter. The map belongs to the whole session, so hole 7 means the same hole in every ' +
      'video; a second video only needs to say where that maze sits in its own frame.',
    definitions: () => [
      el('dl', { class: 'definition-list' }, [
        el('dt', { text: 'Platform circle' }),
        el('dd', {
          text:
            'A least-squares circle through the rim points you click — three is enough — or typed ' +
            'centre and radius. Stored in native video pixels, so zoom and pan never change it (D13, D15).',
        }),
        el('dt', { text: 'Hole ring' }),
        el('dd', {
          text:
            `Holes are generated, not clicked: a count (default ${DEFAULT_HOLE_COUNT}), a ring radius as a ` +
            `fraction of the platform radius (default ${DEFAULT_RING_RATIO}) and one angle. Clicking any hole sets ` +
            'that angle so the whole ring lines up. A single hole can be nudged when a maze is ' +
            'genuinely irregular; nudged holes are marked with an asterisk (O8).',
        }),
        el('dt', { text: 'Target hole' }),
        el('dd', {
          text:
            'The escape hole. It is drawn with a double ring and the label "T", not by colour alone, ' +
            'and it is listed in the table below (D26, D37).',
        }),
        el('dt', { text: 'Calibration' }),
        el('dd', {
          text:
            'The platform diameter in centimetres is the one measurement BarnesTrack needs from you. ' +
            'Every distance threshold is stored in centimetres and converted per video from it, so ' +
            'nothing downstream is computed until it is entered (D14, D44, O8).',
        }),
        el('dt', { text: 'Reusing the map' }),
        el('dd', {
          text:
            'One map is shared by the session. "Apply from" places it in another video by scaling for ' +
            'resolution; "Adjust" refits it from three rim clicks by translation and scale, keeping ' +
            'the ring angle, the target and any nudges (D10, D29).',
        }),
        el('dt', { text: 'Keyboard' }),
        el('dd', {
          text:
            'Every mouse action has a typed equivalent: centre and radius fields instead of rim clicks, ' +
            'the ring-angle field instead of the alignment click, the target-hole number instead of the ' +
            'target click. Tab to the frame, then arrow keys nudge the current selection by 1 px (10 px ' +
            'with Shift); + and − zoom, 0 fits, Alt with the arrow keys pans. On the scrubber: arrow ' +
            'keys move 1 frame, Shift with them 10 frames, Home and End jump to the ends.',
        }),
      ]),
    ],
    body,
    blocked: () =>
      store.videos.length === 0 ? 'load at least one video on the Videos step first' : null,
    refresh: render,
    onShow: () => {
      canvasView.fit();
      void showFrame(scrubber.frameIndex);
    },
  };
}
