/**
 * Step 3 — Track. Runs the automatic pass over each video, shows it working,
 * and writes the automatic layer (D5, D9, D16, D17, D29, D37, D51, D52).
 *
 * The thumbnail is labelled provisional throughout, and means it: the nose and
 * the detection state are decided at the end of the pass from cross-frame
 * cues, so what a running pass can honestly draw is the frame's largest
 * candidate, not a result. The final track replaces it (D16).
 *
 * Progress never touches the session store — the store notifies the whole app
 * on every change, and a pass posts progress several times a second. Only the
 * finished layer is stored, which is also why nothing half-written can exist.
 */
import {
  DEFAULT_TRACKING_PARAMETERS,
  TRACKING_PARAMETER_DEFINITIONS,
} from '../analysis/tracker/params.js';
import type { TrackingParameters } from '../contracts/parameters.js';
import type { VideoDescriptor } from '../contracts/session.js';
import {
  TrackingRunner,
  trackingBlockedReason,
  type RunState,
} from '../session/tracking-runs.js';
import type { VideoId } from '../session/stored.js';
import {
  MANUAL_THRESHOLD_BOUND,
  TRACKING_PARAMETER_BOUNDS,
  clampToBound,
} from '../analysis/tracker/params.js';
import { button, disclosure, el, replaceChildren, uniqueId, type Child } from './dom.js';
import { describeFrameRanges, formatFrameRanges, parseFrameRanges } from './frame-ranges.js';
import type { AppContext, Step } from './step.js';
import {
  formatClock,
  learnedBlobArea_cm2,
  progressLine,
  stateBreakdown,
  summaryLine,
} from './track-summary.js';

const PROVISIONAL = 'provisional — final track computed at end of pass';

const PHASE_TEXT: Record<RunState['phase'], string> = {
  queued: 'Waiting to start',
  sampling: 'Reading background frames',
  preparing: 'Building the background model',
  tracking: 'Tracking',
  done: 'Tracked',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

export function createTrackStep(context: AppContext): Step {
  const { store } = context;

  const body = el('div', { class: 'track-step' });
  const cards = el('div', { class: 'track-list' });
  const cardFor = new Map<VideoId, VideoCard>();
  let lastEpoch = store.epoch;

  const runner = new TrackingRunner(store, {
    onChange: (state) => {
      cardFor.get(state.videoId)?.showRun(state);
      refreshQueueControls();
      // Only when a run settles, not on every progress tick: a finished pass
      // may have a learned body area to offer the other videos (D29).
      if (state.phase === 'done' || state.phase === 'failed' || state.phase === 'cancelled') {
        parameterPanel.refresh();
      }
      announcePhase(state);
    },
    onComplete: (videoId, auto) => {
      store.setAutoLayer(videoId, auto);
    },
  });

  const announced = new Map<VideoId, RunState['phase']>();
  function announcePhase(state: RunState): void {
    // Only transitions, never the per-frame ticks: the live region is for
    // events a screen-reader user needs told, not a running commentary.
    if (announced.get(state.videoId) === state.phase) return;
    announced.set(state.videoId, state.phase);
    const name = store.videoById(state.videoId)?.filename ?? state.videoId;
    if (state.phase === 'tracking') context.announce(`Tracking ${name}.`);
    else if (state.phase === 'cancelled') context.announce(`Tracking ${name} cancelled.`);
    else if (state.phase === 'failed') context.announce(`Tracking ${name} failed: ${state.error ?? ''}`);
    else if (state.phase === 'done' && state.result) {
      context.announce(`Finished ${name}. ${summaryLine(state.result.summary, state.result.frames)}`);
    }
  }

  // ---- tracking parameters panel ---------------------------------------------

  const parameterPanel = createParameterPanel(context, runner, () => {
    for (const card of cardFor.values()) card.refresh();
  });

  // ---- queue controls ---------------------------------------------------------

  const trackAllButton = button('Track all untracked', () => {
    const ids = runner.untracked();
    if (ids.length === 0) {
      context.announce('Nothing to track: every video that can be tracked already has a track.');
      return;
    }
    for (const id of ids) runner.enqueue(id);
    context.announce(`Queued ${ids.length} video${ids.length === 1 ? '' : 's'} for tracking.`);
  });
  trackAllButton.className = 'primary';

  const cancelAllButton = button('Cancel all', () => {
    runner.cancelAll();
    context.announce('Cancelling the tracking queue.');
  });

  const queueState = el('p', { class: 'queue-state', attrs: { 'aria-live': 'off' } });

  function refreshQueueControls(): void {
    const untracked = runner.untracked().length;
    trackAllButton.disabled = untracked === 0;
    if (!runner.busy && document.activeElement === cancelAllButton) trackAllButton.focus();
    cancelAllButton.hidden = !runner.busy;
    const tracked = store.videos.filter((v) => store.analysisFor(v.id) !== undefined).length;
    queueState.textContent =
      `${tracked} of ${store.videos.length} video${store.videos.length === 1 ? '' : 's'} tracked` +
      (untracked > 0 ? ` · ${untracked} ready to track` : '') +
      (runner.busy ? ' · a pass is running; the other steps stay usable' : '');
  }

  const controls = el('div', { class: 'track-controls' }, [
    trackAllButton,
    cancelAllButton,
    queueState,
  ]);

  replaceChildren(body, [controls, parameterPanel.element, cards]);

  // ---- rendering ---------------------------------------------------------------

  function render(): void {
    if (store.epoch !== lastEpoch) {
      lastEpoch = store.epoch;
      runner.destroy();
      cardFor.clear();
      announced.clear();
      replaceChildren(cards, []);
    }
    const present = new Set<VideoId>();
    const children: Child[] = [];
    for (const video of store.videos) {
      present.add(video.id);
      let card = cardFor.get(video.id);
      if (!card) {
        card = createVideoCard(context, video.id, runner);
        cardFor.set(video.id, card);
      }
      card.refresh();
      children.push(card.element);
    }
    for (const id of [...cardFor.keys()]) if (!present.has(id)) cardFor.delete(id);
    replaceChildren(cards, children);
    parameterPanel.refresh();
    refreshQueueControls();
  }

  return {
    id: 'track',
    label: 'Track',
    what:
      'Run the automatic tracking pass over each video and watch it work. Tracking runs in the ' +
      'background, so you can keep working on the Videos and Maze steps while it does.',
    definitions: () => [
      el('ul', {}, [
        el('li', {
          text:
            'Automatic values are never overwritten: a correction is stored beside the automatic ' +
            'layer and everything downstream is recomputed (D9, D25).',
        }),
        el('li', {
          text:
            'A frame the tracker could not resolve stays visibly missing; nothing is interpolated ' +
            'silently (D16).',
        }),
        el('li', {
          text:
            'The thumbnail during a pass is provisional. The nose and the detection state are ' +
            'decided at the end of the pass from cues across frames, so a running pass can only ' +
            'show you the largest blob it found on the frame, not the result.',
        }),
        el('li', {
          text:
            'Re-tracking replaces the automatic layer and leaves every correction you have made ' +
            'exactly where it was.',
        }),
      ]),
    ],
    body,
    blocked: () => {
      if (store.videos.length === 0) return 'no videos are loaded yet — start on the Videos step';
      if (store.current.mazeMap === null) {
        return 'the maze is not finished — mark the platform and enter its diameter on the Maze step';
      }
      return null;
    },
    refresh: render,
    onShow: render,
  };
}

// ---- one video ----------------------------------------------------------------

interface VideoCard {
  element: HTMLElement;
  refresh(): void;
  showRun(state: RunState): void;
}

function createVideoCard(context: AppContext, videoId: VideoId, runner: TrackingRunner): VideoCard {
  const { store } = context;

  // The card names itself, so the three "Track" buttons of a three-video
  // cohort are told apart by assistive technology (D37).
  const heading = el('h3', { id: uniqueId('track-card') });
  const status = el('p', { class: 'track-status' });
  const detail = el('p', { class: 'track-detail' });
  const blockedNote = el('p', { class: 'hint track-blocked', id: uniqueId('track-blocked') });
  const warnings = el('ul', { class: 'track-warnings' });

  const trackButton = button('Track', () => {
    runner.enqueue(videoId);
  });
  // So a disabled button says why, not just that it is disabled.
  trackButton.setAttribute('aria-describedby', blockedNote.id);
  const cancelButton = button('Cancel', () => {
    runner.cancel(videoId);
  });

  const progressText = el('p', {
    class: 'track-progress-text',
    id: uniqueId('track-progress'),
    attrs: { 'aria-live': 'off' },
  });
  const bar = el('progress', {
    class: 'track-progress',
    attrs: { 'aria-labelledby': progressText.id },
  });
  bar.max = 1;

  const preview = el('canvas', {
    class: 'track-preview',
    attrs: { role: 'img', 'aria-label': `Tracking preview, ${PROVISIONAL}` },
  });
  const previewCaption = el('p', { class: 'track-preview-caption', text: PROVISIONAL });
  const previewWrap = el('div', { class: 'track-preview-wrap' }, [preview, previewCaption]);
  previewWrap.hidden = true;

  const element = el('div', { class: 'track-card', attrs: { role: 'group', 'aria-labelledby': heading.id } }, [
    heading,
    status,
    detail,
    blockedNote,
    warnings,
    el('div', { class: 'track-actions' }, [trackButton, cancelButton]),
    bar,
    progressText,
    previewWrap,
  ]);

  function refresh(): void {
    const video = store.videoById(videoId);
    if (!video) return;
    heading.textContent = describeVideo(video);

    const state = runner.stateFor(videoId);
    const blocked = trackingBlockedReason(store, videoId);
    const analysis = store.analysisFor(videoId);

    blockedNote.textContent = blocked === null ? '' : `Cannot track yet: ${blocked}.`;
    blockedNote.hidden = blocked === null;

    const running = state !== undefined && runner.isActive(videoId);
    trackButton.disabled = blocked !== null || running;
    trackButton.textContent = analysis ? 'Track again' : 'Track';
    // Hiding the focused button would drop focus to the top of the document,
    // so a keyboard user who tabbed to Cancel and did not press it keeps a
    // place on this card (D37).
    if (!running && document.activeElement === cancelButton) trackButton.focus();
    cancelButton.hidden = !running;
    bar.hidden = !running;
    progressText.hidden = !running;

    if (running && state) {
      showRun(state);
      return;
    }

    previewWrap.hidden = true;
    if (state?.phase === 'done' && state.result) {
      status.textContent = `Tracked · ${summaryLine(state.result.summary, state.result.frames)}`;
      status.className = 'track-status is-done';
      detail.textContent =
        `${stateBreakdown(state.result.summary)} · ${state.result.frames.length.toLocaleString()} frames ` +
        `in ${(state.elapsedMs / 1000).toFixed(1)} s ` +
        `(${Math.round(state.result.timing.fps).toLocaleString()} frames/s in the tracker)`;
      showWarnings(state.warnings);
      return;
    }
    if (state?.phase === 'cancelled') {
      status.textContent = 'Cancelled — nothing was written, so the video is still untracked.';
      status.className = 'track-status is-cancelled';
      detail.textContent = '';
      showWarnings([]);
      return;
    }
    if (state?.phase === 'failed') {
      status.textContent = `Failed: ${state.error ?? 'the tracking pass did not finish'}`;
      status.className = 'track-status is-failed';
      detail.textContent = '';
      showWarnings([]);
      return;
    }
    if (analysis) {
      // A hand-edited or truncated session file can carry an analysis with no
      // frames. Say so and stay usable rather than throwing mid-render and
      // leaving the step half-drawn.
      const frameCount = analysis.auto?.frames?.length;
      const corrections = analysis.corrections?.entries?.length ?? 0;
      if (frameCount === undefined) {
        status.textContent =
          'This video has an analysis with no track in it — the session file may have been edited by hand. Track it again to replace it.';
        status.className = 'track-status is-failed';
        detail.textContent = '';
        showWarnings([]);
        return;
      }
      status.textContent = `Tracked · ${frameCount.toLocaleString()} frames on record`;
      status.className = 'track-status is-done';
      detail.textContent =
        corrections > 0
          ? `${corrections} correction(s) kept; re-tracking will not touch them.`
          : 'Loaded from this session. Re-track to apply changed parameters.';
      showWarnings([]);
      return;
    }
    status.textContent = 'Not tracked yet';
    status.className = 'track-status is-untracked';
    detail.textContent = '';
    showWarnings([]);
  }

  function showWarnings(list: string[]): void {
    warnings.hidden = list.length === 0;
    replaceChildren(
      warnings,
      list.map((text) => el('li', { class: 'warn', text })),
    );
  }

  function showRun(state: RunState): void {
    if (!runner.isActive(videoId)) {
      refresh();
      return;
    }
    status.textContent = PHASE_TEXT[state.phase];
    status.className = 'track-status is-running';
    detail.textContent = '';
    showWarnings(state.warnings);

    bar.hidden = false;
    progressText.hidden = false;
    cancelButton.hidden = false;
    trackButton.disabled = true;

    if (state.phase === 'sampling') {
      bar.value = state.total > 0 ? state.done / state.total : 0;
      progressText.textContent = `Background frame ${state.done} of ${state.total}`;
    } else if (state.phase === 'preparing') {
      bar.removeAttribute('value');
      progressText.textContent = 'Building the background model from the sample frames…';
    } else {
      bar.value = state.total > 0 ? state.done / state.total : 0;
      progressText.textContent = progressLine(state.done, state.total, state.fps, state.etaSeconds);
    }

    if (state.preview) {
      drawPreview(preview, state.preview);
      preview.setAttribute(
        'aria-label',
        `Tracking preview at frame ${state.done.toLocaleString()} of ${state.total.toLocaleString()}, ` +
          `${state.preview.candidateCount} blob${state.preview.candidateCount === 1 ? '' : 's'} found — ${PROVISIONAL}`,
      );
      previewWrap.hidden = false;
    }
  }

  return { element, refresh, showRun };
}

function describeVideo(video: VideoDescriptor): string {
  const meta = [video.metadata.animal, video.metadata.day, video.metadata.trial]
    .filter((v) => v !== undefined && v !== '')
    .join(' · ');
  const length = formatClock(video.fingerprint.durationSeconds);
  return meta ? `${video.filename} — ${meta} (${length})` : `${video.filename} (${length})`;
}

/**
 * The gray plane as pixels, with the provisional pick drawn over it. Drawn as
 * an outline and a cross rather than a filled dot, and captioned, so nothing
 * here reads as a settled result (D16, D26).
 */
function drawPreview(
  canvas: HTMLCanvasElement,
  preview: { gray: Uint8Array; width: number; height: number } & {
    centroid: { x: number; y: number } | null;
    axis: { ax: number; ay: number; bx: number; by: number } | null;
  },
): void {
  canvas.width = preview.width;
  canvas.height = preview.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const image = ctx.createImageData(preview.width, preview.height);
  for (let i = 0; i < preview.gray.length; i++) {
    const v = preview.gray[i]!;
    image.data[i * 4] = v;
    image.data[i * 4 + 1] = v;
    image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  if (preview.axis) {
    ctx.strokeStyle = '#0a4d8c';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(preview.axis.ax, preview.axis.ay);
    ctx.lineTo(preview.axis.bx, preview.axis.by);
    ctx.stroke();
  }
  if (preview.centroid) {
    const { x, y } = preview.centroid;
    ctx.strokeStyle = '#9a2417';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.moveTo(x - 8, y);
    ctx.lineTo(x + 8, y);
    ctx.moveTo(x, y - 8);
    ctx.lineTo(x, y + 8);
    ctx.stroke();
  }
}

// ---- tracking parameters -------------------------------------------------------

interface ParameterPanel {
  element: HTMLElement;
  refresh(): void;
}

/**
 * Numeric tracking parameters, in the order the pass uses them. The label is
 * this file's business; the admissible range is not — it decides the value
 * that gets hashed, so it lives with the defaults in `src/analysis/tracker/params.ts`.
 */
type NumberFieldKey = Exclude<
  keyof TrackingParameters,
  'threshold' | 'backgroundExcludeRanges' | 'expectedBlobArea_cm2'
>;

const NUMBER_FIELDS: { key: NumberFieldKey; label: string }[] = [
  { key: 'backgroundSampleCount', label: 'Background sample frames' },
  { key: 'platformMaskMargin_cm', label: 'Platform mask margin (cm)' },
  { key: 'minBlobArea_cm2', label: 'Smallest blob (cm²)' },
  { key: 'maxBlobArea_cm2', label: 'Largest blob (cm²)' },
  { key: 'oversizedBlobFactor', label: 'Oversized blob factor' },
  { key: 'smallBlobFactor', label: 'Small blob factor' },
  { key: 'tailOpeningRadius_cm', label: 'Tail opening radius (cm)' },
  { key: 'noseCueWindowFrames', label: 'Nose velocity window (frames)' },
  { key: 'noseMovingSpeed_cmPerS', label: 'Moving speed (cm/s)' },
  { key: 'rimContactMargin_cm', label: 'Rim contact margin (cm)' },
  { key: 'proximityRadius_cm', label: 'Proximity radius (cm)' },
  { key: 'fragmentMergeDistance_cm', label: 'Fragment merge distance (cm)' },
];

function createParameterPanel(
  context: AppContext,
  runner: TrackingRunner,
  onChange: () => void,
): ParameterPanel {
  const { store } = context;
  const inputs = new Map<keyof TrackingParameters, HTMLInputElement>();
  const rows: Child[] = [];

  function current(): TrackingParameters {
    return store.trackingParameters;
  }

  function commit(patch: Partial<TrackingParameters>): void {
    store.setTrackingParameters({ ...current(), ...patch });
    onChange();
  }

  for (const spec of NUMBER_FIELDS) {
    const bound = TRACKING_PARAMETER_BOUNDS[spec.key];
    const input = el('input', { id: uniqueId('track-param'), class: 'number-input' });
    input.type = 'number';
    input.step = bound.step;
    input.min = String(bound.min);
    input.max = String(bound.max);
    input.addEventListener('change', () => {
      const typed = Number(input.value);
      if (input.value.trim() === '' || !Number.isFinite(typed)) {
        context.announce(`${spec.label} needs a number.`);
        refresh();
        return;
      }
      const value = clampToBound(typed, bound);
      commit({ [spec.key]: value } as unknown as Partial<TrackingParameters>);
      if (value !== typed) {
        input.value = String(value);
        context.announce(
          `${spec.label} must be between ${bound.min} and ${bound.max}, so ${typed} became ${value}.`,
        );
      }
    });
    inputs.set(spec.key, input);

    const definition = el('span', {
      class: 'hint',
      id: `${input.id}-hint`,
      text: TRACKING_PARAMETER_DEFINITIONS[spec.key],
    });
    input.setAttribute('aria-describedby', definition.id);
    const defaultValue = DEFAULT_TRACKING_PARAMETERS[spec.key];
    rows.push(
      el('div', { class: 'field track-param' }, [
        el('label', { text: spec.label, attrs: { for: input.id } }),
        input,
        el('span', { class: 'track-param-default', text: `default ${String(defaultValue)}` }),
        definition,
      ]),
    );
  }

  // Threshold mode: the one non-numeric field, and the manual value it gates.
  const modeSelect = el('select', { id: uniqueId('track-param'), class: 'number-input' });
  for (const [value, text] of [
    ['otsu', 'Otsu — chosen from the video'],
    ['manual', 'Manual'],
  ] as const) {
    modeSelect.append(el('option', { text, attrs: { value } }));
  }
  modeSelect.addEventListener('change', () => {
    commit({
      threshold: {
        mode: modeSelect.value === 'manual' ? 'manual' : 'otsu',
        manualValue: current().threshold.manualValue,
      },
    });
    refresh();
  });

  const manualInput = el('input', { id: uniqueId('track-param'), class: 'number-input' });
  manualInput.type = 'number';
  manualInput.step = MANUAL_THRESHOLD_BOUND.step;
  manualInput.min = String(MANUAL_THRESHOLD_BOUND.min);
  manualInput.max = String(MANUAL_THRESHOLD_BOUND.max);
  manualInput.addEventListener('change', () => {
    const typed = Number(manualInput.value);
    if (manualInput.value.trim() === '' || !Number.isFinite(typed)) {
      context.announce(
        `The manual threshold needs a number from ${MANUAL_THRESHOLD_BOUND.min} to ${MANUAL_THRESHOLD_BOUND.max}.`,
      );
      refresh();
      return;
    }
    const value = clampToBound(typed, MANUAL_THRESHOLD_BOUND);
    commit({ threshold: { mode: current().threshold.mode, manualValue: value } });
    if (value !== typed) {
      manualInput.value = String(value);
      // Announced like every other clamp: a screen-reader user must not have a
      // value silently changed under them.
      context.announce(
        `Manual threshold must be between ${MANUAL_THRESHOLD_BOUND.min} and ${MANUAL_THRESHOLD_BOUND.max}, so ${typed} became ${value}.`,
      );
    }
  });

  const thresholdHint = el('span', {
    class: 'hint',
    id: `${modeSelect.id}-hint`,
    text: TRACKING_PARAMETER_DEFINITIONS.threshold,
  });
  modeSelect.setAttribute('aria-describedby', thresholdHint.id);

  const manualHint = el('span', {
    class: 'hint',
    id: `${manualInput.id}-hint`,
    text: 'Used only when the threshold mode above is Manual.',
  });
  manualInput.setAttribute('aria-describedby', manualHint.id);

  rows.push(
    el('div', { class: 'field track-param' }, [
      el('label', { text: 'Foreground threshold', attrs: { for: modeSelect.id } }),
      modeSelect,
      el('span', { class: 'track-param-default', text: 'default Otsu' }),
      thresholdHint,
    ]),
    el('div', { class: 'field track-param' }, [
      el('label', {
        text: `Manual threshold (${MANUAL_THRESHOLD_BOUND.min}–${MANUAL_THRESHOLD_BOUND.max})`,
        attrs: { for: manualInput.id },
      }),
      manualInput,
      el('span', { class: 'track-param-default', text: 'default 40' }),
      manualHint,
    ]),
  );

  // Background exclude ranges: the remedy the contamination warning names.
  const excludeInput = el('input', { id: uniqueId('track-param'), class: 'range-input' });
  excludeInput.type = 'text';
  excludeInput.placeholder = 'e.g. 0-74, 200-210';
  excludeInput.addEventListener('change', () => {
    const parsed = parseFrameRanges(excludeInput.value);
    if (!parsed.ok) {
      context.announce(parsed.message);
      refresh();
      return;
    }
    commit({ backgroundExcludeRanges: parsed.ranges });
    refresh();
    context.announce(`Background exclude ranges: ${describeFrameRanges(parsed.ranges)}.`);
  });

  const excludeHint = el('span', {
    class: 'hint',
    id: `${excludeInput.id}-hint`,
    text: TRACKING_PARAMETER_DEFINITIONS.backgroundExcludeRanges,
  });
  excludeInput.setAttribute('aria-describedby', excludeHint.id);
  const excludeSummary = el('span', { class: 'track-param-default' });

  rows.push(
    el('div', { class: 'field track-param' }, [
      el('label', { text: 'Background exclude ranges', attrs: { for: excludeInput.id } }),
      excludeInput,
      excludeSummary,
      excludeHint,
    ]),
  );

  // Expected body area: null means "learn it from the video" (D29).
  const expectedBound = TRACKING_PARAMETER_BOUNDS.expectedBlobArea_cm2;
  const expectedInput = el('input', { id: uniqueId('track-param'), class: 'number-input' });
  expectedInput.type = 'number';
  expectedInput.step = expectedBound.step;
  expectedInput.min = String(expectedBound.min);
  expectedInput.max = String(expectedBound.max);
  expectedInput.placeholder = 'learned from the video';
  expectedInput.addEventListener('change', () => {
    const text = expectedInput.value.trim();
    if (text === '') {
      commit({ expectedBlobArea_cm2: null });
      context.announce('Expected body area will be learned from each video.');
      return;
    }
    const typed = Number(text);
    if (!Number.isFinite(typed)) {
      context.announce('Expected body area needs a number, or leave it empty to learn it.');
      refresh();
      return;
    }
    const value = clampToBound(typed, expectedBound);
    commit({ expectedBlobArea_cm2: value });
    if (value !== typed) {
      expectedInput.value = String(value);
      context.announce(
        `Expected body area must be between ${expectedBound.min} and ${expectedBound.max} cm², so ${typed} became ${value}.`,
      );
    }
  });

  const expectedHint = el('span', {
    class: 'hint',
    id: `${expectedInput.id}-hint`,
    text: TRACKING_PARAMETER_DEFINITIONS.expectedBlobArea_cm2,
  });
  expectedInput.setAttribute('aria-describedby', expectedHint.id);
  const learnedNote = el('p', { class: 'track-learned' });
  const useLearnedButton = button('Use this for every video', () => {
    const learned = firstLearnedArea();
    if (learned === null) return;
    commit({ expectedBlobArea_cm2: Number(learned.area.toFixed(1)) });
    context.announce(
      `Expected body area set to ${learned.area.toFixed(1)} cm², learned from ${learned.filename}.`,
    );
    refresh();
  });

  rows.push(
    el('div', { class: 'field track-param' }, [
      el('label', { text: 'Expected body area (cm²)', attrs: { for: expectedInput.id } }),
      expectedInput,
      el('span', { class: 'track-param-default', text: 'default: learned' }),
      expectedHint,
      learnedNote,
      useLearnedButton,
    ]),
  );

  /**
   * The body area the first video tracked in this tab learned, for D29's
   * offer to the rest. It comes from the run's summary rather than the stored
   * layer, because the learned area is evidence about the pass, not part of
   * the track contract — a reload forgets it, and it is only ever an offer.
   */
  function firstLearnedArea(): { area: number; filename: string } | null {
    for (const video of store.videos) {
      const summary = runner.stateFor(video.id)?.result?.summary;
      if (!summary) continue;
      const area = learnedBlobArea_cm2(summary);
      if (area !== null) return { area, filename: video.filename };
    }
    return null;
  }

  const resetButton = button('Reset to defaults', () => {
    store.setTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS });
    onChange();
    refresh();
    context.announce('Tracking parameters reset to their defaults.');
  });

  const panel = disclosure('Tracking parameters', [
    el('p', {
      class: 'hint',
      text:
        'Every threshold the tracking pass uses, with the definition it is applied by. Changing ' +
        'one does not alter a track that has already been computed — re-track the video to apply ' +
        'it. A pass already running keeps the values it started with; videos still waiting in the ' +
        'queue will use the new ones.',
    }),
    el('div', { class: 'track-params' }, rows),
    resetButton,
  ]);

  function refresh(): void {
    const params = current();
    for (const [key, input] of inputs) {
      const value = params[key];
      if (document.activeElement !== input) input.value = String(value);
    }
    if (document.activeElement !== modeSelect) modeSelect.value = params.threshold.mode;
    if (document.activeElement !== manualInput) {
      manualInput.value = String(params.threshold.manualValue);
    }
    manualInput.disabled = params.threshold.mode !== 'manual';
    if (document.activeElement !== expectedInput) {
      expectedInput.value =
        params.expectedBlobArea_cm2 === null ? '' : String(params.expectedBlobArea_cm2);
    }
    if (document.activeElement !== excludeInput) {
      excludeInput.value = formatFrameRanges(params.backgroundExcludeRanges);
    }
    excludeSummary.textContent = describeFrameRanges(params.backgroundExcludeRanges);

    const learned = firstLearnedArea();
    learnedNote.hidden = learned === null;
    learnedNote.textContent =
      learned === null
        ? ''
        : `Learned from ${learned.filename}: ${learned.area.toFixed(1)} cm².`;
    useLearnedButton.hidden = learned === null || params.expectedBlobArea_cm2 !== null;
  }

  return { element: panel, refresh };
}
