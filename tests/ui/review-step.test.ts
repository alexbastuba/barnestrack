// @vitest-environment happy-dom
/**
 * The Review step with chunk 7a's four panels mounted in it: that they are in
 * the four mount points, that a threshold change re-derives every video and
 * leaves a corrected event pinned, that the diff badge reads the change, and
 * that the quality panel moves when a range correction does.
 *
 * happy-dom has no 2D context, so the frame view and the timeline draw nothing
 * here; everything asserted is DOM. The canvases are covered in Chrome by
 * `tests/browser/review.spec.ts` and the recorded manual pass.
 */
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import {
  CHANGE_DEBOUNCE_MS,
  formatHole,
  formatSeconds,
} from '../../src/ui/components/index.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { analyseAllVideos } from '../../src/session/analyse.js';
import { NO_CORRECTIONS, confirmedEventIds, editEvent, markRange, setPoint } from '../../src/session/corrections.js';
import { describeQueue, eventsToCheck } from '../../src/ui/review-queue.js';
import { eventRows } from '../../src/export/rows.js';
import { stateRuns } from '../../src/viz/quality-strip.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { createReviewStep } from '../../src/ui/review-step.js';
import { TRACKS, frameToX } from '../../src/ui/timeline-geometry.js';
import type { AppContext, Step, StepId } from '../../src/ui/step.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

const TOOL_VERSION = 'barnestrack v0.1.0 (rev0000)';

interface Harness {
  store: SessionStore;
  step: Step;
  said: string[];
  shown: StepId[];
  session: SessionFile;
}

function mount(session: SessionFile = syntheticSession(), options: { keepSelection?: boolean } = {}): Harness {
  // The selected event is remembered per page in sessionStorage (selection-memory.ts); each
  // mount is a fresh page unless a test is checking exactly that memory.
  if (!options.keepSelection) sessionStorage.clear();
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(session);
  analyseAllVideos(store); // `replaceSession` drops the caches (A2)
  const said: string[] = [];
  const shown: StepId[] = [];
  const context: AppContext = {
    store,
    toolVersion: TOOL_VERSION,
    announce: (message) => said.push(message),
    showStep: (id) => shown.push(id),
  };
  const step = createReviewStep(context);
  document.body.append(step.body);
  store.subscribe(() => step.refresh());
  step.refresh();
  return { store, step, said, shown, session };
}

function panel(step: Step, id: string): HTMLElement {
  return step.body.querySelector<HTMLElement>(`#${id}`)!;
}

/** The one Export bundle button, in the step's action bar (D72), never a second one by the manifest. */
function exportButton(step: Step): HTMLButtonElement {
  const buttons = [...step.body.querySelectorAll<HTMLButtonElement>('button')].filter(
    (b) => b.textContent === 'Export bundle (.zip)',
  );
  expect(buttons).toHaveLength(1);
  expect(buttons[0]!.closest('.action-bar')).not.toBeNull();
  return buttons[0]!;
}

/**
 * Types a value into one of the mounted panel's own rows and lets the debounce
 * fire — the path a user takes, so `onParametersChange` and everything the step
 * hangs off it are what is under test, not a hand-called store method.
 */
function typeParameter(step: Step, label: string, value: number): void {
  const row = [...step.body.querySelectorAll<HTMLElement>('#review-parameters .param-row')].find(
    (candidate) => candidate.querySelector('label')!.textContent === label,
  );
  expect(row, `no parameter row labelled "${label}"`).toBeDefined();
  const input = row!.querySelector<HTMLInputElement>('input[type="number"]')!;
  input.value = String(value);
  input.dispatchEvent(new Event('input'));
  vi.advanceTimersByTime(CHANGE_DEBOUNCE_MS + 1);
}

describe('the Review step mounts the four panels', () => {
  let harness: Harness;

  beforeEach(() => {
    document.body.replaceChildren();
    harness = mount();
  });

  it('puts one component in each of the four mount points', () => {
    expect(panel(harness.step, 'review-parameters').querySelector('.parameters-panel')).not.toBeNull();
    expect(panel(harness.step, 'review-metrics').querySelector('.metrics-card')).not.toBeNull();
    expect(panel(harness.step, 'review-events').querySelector('.event-panel')).not.toBeNull();
    expect(panel(harness.step, 'review-quality').querySelector('.quality-panel')).not.toBeNull();
  });

  it('leaves the box on the mount point and the region on the component', () => {
    for (const id of ['review-parameters', 'review-metrics', 'review-events', 'review-quality']) {
      const mountPoint = panel(harness.step, id);
      // The mount point is the box; it names no heading of its own, because the
      // component inside it is the labelled region.
      expect(mountPoint.tagName).toBe('DIV');
      expect(mountPoint.classList.contains('review-panel')).toBe(true);
      expect(mountPoint.hasAttribute('aria-labelledby')).toBe(false);
      const component = mountPoint.firstElementChild!;
      expect(component.tagName).toBe('SECTION');
      expect(component.classList.contains('review-panel')).toBe(false);
      const heading = component.getAttribute('aria-labelledby')!;
      expect(component.querySelector(`#${heading}`)!.tagName).toBe('H3');
    }
  });

  it('keeps the 12-column events table as a mirror, beside the other two', () => {
    const mirror = harness.step.body.querySelector('#review-events-mirror')!;
    const headers = [...mirror.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(headers).toEqual([
      'Kind',
      'Hole',
      'Target',
      'Frames',
      'Start (s)',
      'Duration (s)',
      'Point used',
      'Min nose (cm)',
      'Min centroid (cm)',
      'Source',
      'Flag',
      'Evidence',
    ]);
    // Closed by default: it repeats what the event cards above already say.
    expect(mirror.querySelector('details')!.hasAttribute('open')).toBe(false);
  });

  it('mounts the figures and the export below the panels', () => {
    expect(harness.step.body.querySelector('#review-figures')).not.toBeNull();
    expect(harness.step.body.querySelector('#review-export')).not.toBeNull();
  });

  it('updates the panels rather than remounting them when the video changes', () => {
    const before = panel(harness.step, 'review-metrics').querySelector('.metrics-card');
    const select = harness.step.body.querySelector<HTMLSelectElement>('select')!;

    select.value = harness.session.videos[1]!.id;
    select.dispatchEvent(new Event('change'));

    // The same node, with new content: a remount would lose a slider drag and
    // the focused event card (chunk 7a's recorded lesson).
    expect(panel(harness.step, 'review-metrics').querySelector('.metrics-card')).toBe(before);
  });
});

describe('the step re-derives what the store invalidated', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('does not call an analysed cohort unanalysed after a session load', () => {
    // The store drops the caches on `replaceSession` (D55), so the step has to
    // put them back; otherwise loading a session file — or the D33 example
    // cohort, which ships with no video attached — shows three empty figures and
    // a disabled export button under a sentence saying nothing is analysed.
    const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
    store.replaceSession(syntheticSession());
    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived)).toEqual([null, null, null]);

    const context: AppContext = {
      store,
      toolVersion: TOOL_VERSION,
      announce: () => undefined,
      showStep: () => undefined,
    };
    const step = createReviewStep(context);
    document.body.append(step.body);
    store.subscribe(() => step.refresh());
    step.refresh();

    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived ?? null)).not.toContain(null);
    expect(step.body.querySelector<HTMLElement>('.figure-missing-block')!.hidden).toBe(true);
    expect(exportButton(step).disabled).toBe(false);
    expect(step.body.querySelector<HTMLElement>('#review-export .figure-missing')!.hidden).toBe(true);
  });

  it('puts the caches back after a maze nudge, so the export stays available', () => {
    const harness = mount();
    const first = harness.store.videos[0]!;

    harness.store.setMazeTransform(first.id, { ...first.mazeTransform, rotationDeg: 3 });

    expect(harness.store.videos.map((v) => harness.store.analysisFor(v.id)?.derived ?? null)).not.toContain(null);
    expect(exportButton(harness.step).disabled).toBe(false);
    expect(harness.step.body.querySelector<HTMLElement>('.figure-missing-block')!.hidden).toBe(true);
  });
});

describe('a threshold change re-derives every video, through the panel', () => {
  let harness: Harness;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    harness = mount();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes the parameters and gives every video the new hash (D28)', () => {
    typeParameter(harness.step, 'Merge gap', 1);

    expect(harness.store.current.parameters!.holeInvestigation.mergeGap_s).toBe(1);
    // The parameters are shared, so one edit moves all three videos at once —
    // not only the one on screen (trust audit A2).
    const expected = hashParameters(harness.store.current.parameters!);
    expect(harness.store.videos).toHaveLength(3);
    for (const video of harness.store.videos) {
      expect(harness.store.analysisFor(video.id)!.derived!.quality.parametersHash).toBe(expected);
    }
  });

  it('leaves a corrected event pinned across the change (D20)', () => {
    const video = harness.store.videos[0]!;
    const corrected = harness.store
      .analysisFor(video.id)!
      .derived!.events.filter((event) => event.source === 'corrected');
    expect(corrected.length).toBeGreaterThan(0);

    typeParameter(harness.step, 'Min duration', 0.4);

    const after = harness.store.analysisFor(video.id)!.derived!.events;
    for (const event of corrected) {
      const still = after.find((candidate) => candidate.id === event.id);
      expect(still, `${event.id} was unpinned by a threshold change`).toBeDefined();
      expect(still!.source).toBe('corrected');
      expect(still!.holeIndex).toBe(event.holeIndex);
    }
  });

  it('reads the change out in the badge and in the live region', () => {
    const badge = panel(harness.step, 'review-parameters').querySelector('output.diff-badge')!;

    typeParameter(harness.step, 'Trial cutoff', 60);

    // A known change on a known fixture: censoring test50's trial at 60 s drops
    // the investigations after it, so the error counts fall by a stated amount.
    expect(badge.textContent).toContain('primary errors 8 → 6');
    expect(badge.textContent).toContain('total errors 13 → 6');
    // Spoken once, with the badge appended to what the panel says changed —
    // not twice, with the second overwriting the first.
    const spoken = harness.said[harness.said.length - 1]!;
    expect(spoken).toContain('Trial cutoff set to 60');
    expect(spoken).toContain('3 videos recomputed');
  });

  it('recomputes only what it must, and says how long it took', () => {
    typeParameter(harness.step, 'Merge gap', 0.8);
    expect(harness.said[harness.said.length - 1]).toMatch(/3 videos recomputed in [\d.]+ ms/);
  });
});

describe('the quality panel follows a correction (chunk 7 acceptance)', () => {
  it('moves the positioned fraction, the gap list and the tier', () => {
    document.body.replaceChildren();
    const harness = mount();
    const video = harness.store.videos[0]!;
    const quality = panel(harness.step, 'review-quality');
    const before = quality.textContent!;
    const beforeReport = harness.store.analysisFor(video.id)!.derived!.quality;
    expect(beforeReport.tier).toBe('GOOD');

    // "Animal not visible here" over a stretch of the trial, through chunk 6's
    // own pure op — the same path the range tool takes. Long enough to move the
    // tier: a shorter range moves the fraction and the gap list but leaves the
    // tier where it was, which would leave this criterion unverified.
    const layer = harness.store.analysisFor(video.id)!.corrections;
    harness.store.setCorrections(
      video.id,
      markRange(layer, 'not_visible', 40, 600, { id: 'test-range', timestamp: '2026-09-07T12:00:00.000Z' }),
    );
    analyseAllVideos(harness.store);
    harness.step.refresh();

    const afterReport = harness.store.analysisFor(video.id)!.derived!.quality;
    expect(afterReport.positionedFraction).toBeLessThan(beforeReport.positionedFraction);
    expect(afterReport.gaps.length).toBeGreaterThan(beforeReport.gaps.length);
    expect(afterReport.tier).not.toBe(beforeReport.tier);
    expect(quality.textContent).not.toBe(before);
    expect(quality.textContent).toContain(afterReport.tier);
  });
});

/**
 * The pointer gestures on the timeline. happy-dom gives the canvas no layout,
 * so its rect is stubbed: 900 px wide at the origin, which is all the geometry
 * needs to turn a clientX into a frame.
 */
function stubCanvasRect(step: Step): HTMLCanvasElement {
  const canvas = step.body.querySelector<HTMLCanvasElement>('.timeline-canvas')!;
  canvas.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 900, height: 124, right: 900, bottom: 124, x: 0, y: 0 }) as DOMRect;
  canvas.setPointerCapture = () => {};
  canvas.releasePointerCapture = () => {};
  canvas.hasPointerCapture = () => true;
  return canvas;
}

/** Inside the detection-state row, where no event edge can claim the press. */
const STATE_ROW_Y = TRACKS.find((track) => track.id === 'state')!.y + 2;
/** Inside the events row, where an edge within six pixels is grabbed instead. */
const EVENTS_ROW_Y = TRACKS.find((track) => track.id === 'events')!.y + 20;

function pointer(type: string, x: number, y: number, shiftKey = false): Event {
  const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.assign(event, { clientX: x, clientY: y, pointerId: 1, button: 0, shiftKey });
  return event;
}

/** The frame the scrubber is showing — what the playhead follows. */
function playheadFrame(step: Step): number {
  return Number(step.body.querySelector<HTMLInputElement>('.frame-range')!.value);
}

describe('dragging on the timeline', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('scrubs: the playhead follows the pointer from press to release', () => {
    const step = mount().step;
    const canvas = stubCanvasRect(step);

    canvas.dispatchEvent(pointer('pointerdown', 90, STATE_ROW_Y));
    const atPress = playheadFrame(step);
    canvas.dispatchEvent(pointer('pointermove', 450, STATE_ROW_Y));
    const afterDrag = playheadFrame(step);

    expect(afterDrag).toBeGreaterThan(atPress);
    // Half way across a 900 px timeline is half way through the clip.
    const frameCount = harnessFrameCount(step);
    expect(afterDrag).toBeGreaterThan(frameCount * 0.4);
    expect(afterDrag).toBeLessThan(frameCount * 0.6);
  });

  it('stops seeking once the pointer is up', () => {
    const step = mount().step;
    const canvas = stubCanvasRect(step);
    canvas.dispatchEvent(pointer('pointerdown', 90, STATE_ROW_Y));
    canvas.dispatchEvent(pointer('pointermove', 450, STATE_ROW_Y));
    const atRelease = playheadFrame(step);
    canvas.dispatchEvent(pointer('pointerup', 450, STATE_ROW_Y));
    canvas.dispatchEvent(pointer('pointermove', 800, STATE_ROW_Y));
    expect(playheadFrame(step)).toBe(atRelease);
  });

  it('retimes instead of scrubbing when the press lands on an event edge', () => {
    const harness = mount();
    const step = harness.step;
    const canvas = stubCanvasRect(step);
    const video = harness.store.videos[0]!;
    const analysis = harness.store.analysisFor(video.id)!.derived!;
    const event = analysis.events[0]!;
    const frameCount = harnessFrameCount(step);
    const edgeX = frameToX(event.startFrame, { first: 0, last: frameCount - 1 }, 900);
    const before = step.body.querySelectorAll('.corrections-list li').length;

    canvas.dispatchEvent(pointer('pointerdown', edgeX, EVENTS_ROW_Y));
    // The edge branch selects the event; it deliberately does not seek.
    expect(playheadFrame(step)).toBe(0);
    canvas.dispatchEvent(pointer('pointerup', edgeX, EVENTS_ROW_Y));

    expect(step.body.querySelectorAll('.corrections-list li').length).toBeGreaterThan(before);
  });

  it('pans on Shift-drag and leaves the playhead where it was', () => {
    const step = mount().step;
    const canvas = stubCanvasRect(step);
    // Zoom in first, or the whole clip is on screen and there is nothing to pan.
    step.body.querySelector<HTMLButtonElement>('.timeline-controls button')!.click();
    const before = playheadFrame(step);
    const readout = step.body.querySelector('.timeline .zoom-readout')!.textContent;

    canvas.dispatchEvent(pointer('pointerdown', 600, 50, true));
    canvas.dispatchEvent(pointer('pointermove', 200, 50, true));

    expect(playheadFrame(step)).toBe(before);
    expect(step.body.querySelector('.timeline .zoom-readout')!.textContent).not.toBe(readout);
  });
});

function harnessFrameCount(step: Step): number {
  return Number(step.body.querySelector<HTMLInputElement>('.frame-range')!.max) + 1;
}

describe('the review queue', () => {
  let harness: Harness;

  beforeEach(() => {
    document.body.replaceChildren();
    harness = mount();
  });

  const count = (): string => harness.step.body.querySelector('.queue-count')!.textContent!;
  const queued = (): string[] => {
    const video = harness.store.videos[0]!;
    const derived = harness.store.analysisFor(video.id)!.derived!;
    return eventsToCheck(derived.events, [], stateRuns(derived.cleanedTrack));
  };

  const strip = (): HTMLElement =>
    harness.step.body.querySelector<HTMLElement>('#review-current-event')!;
  const stripLine = (): string =>
    strip().querySelector('.current-event-line')!.textContent!;

  it('counts the events that want a human, between the video and the timeline', () => {
    const bar = strip();
    expect(bar).not.toBeNull();
    // In the stage, at the head of the column beside the video, above the tools; the stage
    // itself is still above the timeline.
    expect(bar.parentElement!.classList.contains('review-stage-side')).toBe(true);
    expect(bar.nextElementSibling!.classList.contains('review-tools')).toBe(true);
    expect(bar.closest('.review-stage')!.nextElementSibling!.classList.contains('timeline')).toBe(true);
    expect(count()).toBe(describeQueue(queued().length));
    expect(queued().length).toBeGreaterThan(0);
  });

  it('says what to do when nothing is selected, and hides the action hint', () => {
    expect(stripLine()).toBe(
      `${describeQueue(queued().length)} — press ] or click an event on the timeline`,
    );
    expect(strip().querySelector<HTMLElement>('.current-event-hint')!.hidden).toBe(true);
  });

  it('names the selected event in the strip, and never scrolls the page', () => {
    const scrolled = vi.fn();
    // happy-dom has no layout, so the page cannot scroll here; the spy is what
    // proves the queue no longer asks it to, and scrollY pins the position.
    const realScrollIntoView = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrolled;
    onTestFinished(() => {
      Element.prototype.scrollIntoView = realScrollIntoView;
    });
    const before = window.scrollY;

    const next = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')].find(
      (b) => b.textContent === 'Next flagged',
    )!;
    next.click();

    const derived = harness.store.analysisFor(harness.store.videos[0]!.id)!.derived!;
    const first = derived.events.find((e) => e.id === queued()[0])!;
    const line = stripLine();
    expect(line).toContain(first.kind === 'investigation' ? 'Investigation' : 'Escape entry');
    expect(line).toContain(formatHole(first.holeIndex));
    expect(line).toContain(formatSeconds(first.durationSeconds));
    expect(line).toContain('flagged:');
    expect(strip().querySelector<HTMLElement>('.current-event-hint')!.hidden).toBe(false);
    expect(strip().querySelector('.current-event-hint')!.textContent).toContain(
      'Relabel: H then the hole number',
    );

    expect(scrolled).not.toHaveBeenCalled();
    expect(window.scrollY).toBe(before);
  });

  it('re-reads the strip when the selected event is relabelled, and clears it on delete', () => {
    const video = harness.store.videos[0]!;
    const next = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')].find(
      (b) => b.textContent === 'Next flagged',
    )!;
    next.click();
    const selected = harness.store.analysisFor(video.id)!.derived!.events.find(
      (e) => e.id === queued()[0],
    )!;
    const moved = (selected.holeIndex ?? 0) + 1;

    harness.store.setCorrections(
      video.id,
      editEvent(
        harness.store.analysisFor(video.id)!.corrections,
        selected.id,
        { holeIndex: moved, startFrame: selected.startFrame, endFrame: selected.endFrame },
        { id: 'test-strip-relabel', timestamp: '2026-09-07T12:00:00.000Z' },
      ),
    );
    analyseAllVideos(harness.store);
    harness.step.refresh();
    expect(stripLine()).toContain(formatHole(moved));
    expect(stripLine()).toContain('corrected by hand');

    // Delete drops the selection, so the strip goes back to the queue sentence.
    const del = [...harness.step.body.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Delete event (Delete)',
    )!;
    del.click();
    expect(stripLine()).toContain('press ] or click an event on the timeline');
  });

  it('selects and seeks to a flagged event on Next flagged', () => {
    const next = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')].find(
      (b) => b.textContent === 'Next flagged',
    )!;
    expect(next.disabled).toBe(false);
    next.click();

    const video = harness.store.videos[0]!;
    const derived = harness.store.analysisFor(video.id)!.derived!;
    const first = derived.events.find((e) => e.id === queued()[0])!;
    expect(playheadFrame(harness.step)).toBe(first.startFrame);
    // The card list marks the same event as the timeline's selection.
    const selected = harness.step.body.querySelector('#review-events-mirror tr.is-selected');
    expect(selected).not.toBeNull();
  });

  it('walks the queue forwards and backwards', () => {
    const buttons = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')];
    const previous = buttons.find((b) => b.textContent === 'Previous flagged')!;
    const next = buttons.find((b) => b.textContent === 'Next flagged')!;
    next.click();
    const firstFrame = playheadFrame(harness.step);
    next.click();
    expect(playheadFrame(harness.step)).not.toBe(firstFrame);
    previous.click();
    expect(playheadFrame(harness.step)).toBe(firstFrame);
  });

  it('drops the count by one when an event in the queue is corrected', () => {
    const video = harness.store.videos[0]!;
    const before = queued();
    expect(before.length).toBeGreaterThan(0);
    const target = harness.store.analysisFor(video.id)!.derived!.events.find(
      (e) => e.id === before[0],
    )!;

    // Relabelling through the same op the toolbar's hole buttons use.
    const layer = harness.store.analysisFor(video.id)!.corrections;
    harness.store.setCorrections(
      video.id,
      editEvent(
        layer,
        target.id,
        { holeIndex: (target.holeIndex ?? 0) + 1 },
        { id: 'test-relabel', timestamp: '2026-09-07T12:00:00.000Z' },
      ),
    );
    analyseAllVideos(harness.store);
    harness.step.refresh();

    expect(queued().length).toBe(before.length - 1);
    expect(count()).toBe(describeQueue(before.length - 1));
  });

  it('keeps an event as it is: off the queue, the user’s, and in the exports', () => {
    const video = harness.store.videos[0]!;
    const before = queued();
    expect(before.length).toBeGreaterThan(0);
    const correctionsBefore = harness.store.analysisFor(video.id)!.derived!.metrics.correctionCount;

    const next = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')].find(
      (b) => b.textContent === 'Next flagged',
    )!;
    next.click();
    const kept = harness.store.analysisFor(video.id)!.derived!.events.find((e) => e.id === before[0])!;

    // Keep sits on the selected event's card, beside the evidence.
    const keep = [...harness.step.body.querySelectorAll<HTMLButtonElement>('#review-selected button')].find(
      (b) => b.textContent === 'Keep (K)',
    )!;
    expect(keep.disabled).toBe(false);
    keep.click();

    // One fewer to check, and the event is the user's with the automatic values intact.
    expect(queued().length).toBe(before.length - 1);
    expect(count()).toBe(describeQueue(before.length - 1));
    const after = harness.store.analysisFor(video.id)!.derived!.events.find((e) => e.id === kept.id)!;
    expect(after.source).toBe('auto');
    expect(after.confirmed).toBe(true);
    expect(after.holeIndex).toBe(kept.holeIndex);
    expect(after.startFrame).toBe(kept.startFrame);
    expect(after.endFrame).toBe(kept.endFrame);
    expect([...confirmedEventIds(harness.store.analysisFor(video.id)!.corrections)]).toEqual([kept.id]);
    // A confirmation is not a hand edit, so it must not inflate `correction_count`.
    expect(harness.store.analysisFor(video.id)!.derived!.metrics.correctionCount).toBe(
      correctionsBefore,
    );

    // The corrections list says what it is, in the words a confirmation deserves.
    const corrections = [...harness.step.body.querySelectorAll('.corrections-list li')].map(
      (li) => li.textContent ?? '',
    );
    expect(corrections.some((text) => text.includes('confirmed by the user, no change'))).toBe(true);

    // And the export row carries the source, not just the screen (D26).
    const row = eventRows(harness.store.current, TOOL_VERSION).find(
      (candidate) => candidate.videoId === video.id && candidate.eventId === kept.id,
    )!;
    expect(row.source).toBe('auto');
    expect(row.confirmed).toBe(true);

    // Reverting puts it back in the queue.
    const confirmation = [...harness.step.body.querySelectorAll('.corrections-list li')].find((li) =>
      (li.textContent ?? '').includes('confirmed by the user, no change'),
    )!;
    const revert = [...confirmation.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === 'Revert to automatic',
    )!;
    revert.click();
    expect(queued().length).toBe(before.length);
    expect(count()).toBe(describeQueue(before.length));
  });

  it('refuses Keep on a tracking failure, and says why on screen', () => {
    const video = harness.store.videos[0]!;
    const failure = harness.store
      .analysisFor(video.id)!
      .derived!.events.find((e) => e.kind === 'tracking_failure');
    expect(failure, 'the fixture has no tracking failure on its first video').toBeDefined();

    // Selecting it the way the mirror table does.
    const row = [...harness.step.body.querySelectorAll<HTMLButtonElement>('#review-events-mirror th button')].find(
      (b) => b.getAttribute('aria-label')?.includes(`frame ${failure!.startFrame}`),
    )!;
    row.click();

    const panelButtons = [...harness.step.body.querySelectorAll<HTMLButtonElement>('#review-selected button')];
    const keep = panelButtons.find((b) => b.textContent === 'Keep (K)')!;
    expect(keep.disabled).toBe(true);
    const reason = harness.step.body.querySelector<HTMLElement>(`#${keep.getAttribute('aria-describedby')!}`)!;
    expect(reason.hidden).toBe(false);
    expect(reason.textContent).toContain('Keep is off for a tracking failure');
  });
});

/** Presses a key the way the step hears it: from inside the step, here the timeline surface. */
function press(step: Step, key: string, shiftKey = false): void {
  step.body
    .querySelector<HTMLElement>('.timeline-surface')!
    .dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
}

/** The selection as every view draws it: the line, the table row, the card, the playhead. */
function selectionSeen(step: Step): { line: string; row: string | null; card: string | null; frame: number } {
  const row = step.body.querySelector('#review-events-mirror tr.is-selected');
  const card = step.body.querySelector('#review-events li.event-item.is-selected');
  return {
    line: step.body.querySelector('#review-selection-line')!.textContent ?? '',
    row: row?.getAttribute('aria-current') === 'true' ? (row.querySelector('th button')?.getAttribute('aria-label') ?? '') : null,
    card: card?.getAttribute('data-event-id') ?? null,
    frame: playheadFrame(step),
  };
}

describe('one selection, from every route (§1)', () => {
  let harness: Harness;

  beforeEach(() => {
    document.body.replaceChildren();
    harness = mount();
  });

  const events = () => harness.store.analysisFor(harness.store.videos[0]!.id)!.derived!.events;

  it('says in one sentence what to do while nothing is selected', () => {
    expect(selectionSeen(harness.step).line).toMatch(/^Nothing selected — click an event card/);
    expect(harness.step.body.querySelector('#review-selected')!.textContent).toContain('Nothing selected');
  });

  it('a card click selects the event and seeks to its first frame', () => {
    const target = events()[2]!;
    const card = harness.step.body.querySelector<HTMLButtonElement>(
      `#review-events li[data-event-id="${target.id}"] .event-card`,
    )!;
    card.click();
    const seen = selectionSeen(harness.step);
    expect(seen.frame).toBe(target.startFrame);
    expect(seen.card).toBe(target.id);
    expect(seen.row).toContain(`frame ${target.startFrame}`);
    expect(seen.line).toBe(
      `Selected: investigation · hole ${target.holeIndex} · frames ${target.startFrame.toLocaleString()}–${target.endFrame.toLocaleString()}`,
    );
    expect(card.getAttribute('aria-current')).toBe('true');
    // The selected card beside the video is the same event, with its evidence.
    expect(harness.step.body.querySelector('#review-selected .event-item')!.getAttribute('data-event-id')).toBe(target.id);
    expect(harness.step.body.querySelector('#review-selected .event-evidence')).not.toBeNull();
  });

  it('right-aligns only the numbers in the events table (.num)', () => {
    const table = harness.step.body.querySelector('#review-events-mirror table')!;
    expect(table.classList.contains('has-num')).toBe(true);
    const headers = [...table.querySelectorAll('thead th')].map((th) => [th.textContent, th.classList.contains('num')]);
    expect(headers).toContainEqual(['Start (s)', true]);
    expect(headers).toContainEqual(['Point used', false]);
    expect(headers).toContainEqual(['Source', false]);
    const cells = table.querySelector('tbody tr')!.querySelectorAll('td');
    expect(cells[3]!.classList.contains('num')).toBe(true); // start (s)
    expect(cells[5]!.classList.contains('num')).toBe(false); // point used
  });

  it('E selects the same way, and Shift+E goes back', () => {
    press(harness.step, 'e');
    const first = selectionSeen(harness.step);
    const ev = events().find((e) => e.id === first.card)!;
    expect(ev).toBeDefined();
    expect(first.frame).toBe(ev.startFrame);
    expect(first.row).toContain(`frame ${ev.startFrame}`);
    expect(first.line).toContain('Selected: ');
    press(harness.step, 'e');
    expect(selectionSeen(harness.step).card).not.toBe(first.card);
  });

  it('a click on an event bar on the timeline sets the same selection', () => {
    const canvas = stubCanvasRect(harness.step);
    // An automatic event no other event overlaps, so the bar under the pointer is unambiguous.
    const all = events();
    const target = all.find(
      (ev) => ev.source === 'auto' && !all.some((other) => other !== ev && other.startFrame <= ev.endFrame && ev.startFrame <= other.endFrame),
    )!;
    const frameCount = harnessFrameCount(harness.step);
    const middle = Math.round((target.startFrame + target.endFrame) / 2);
    const x = frameToX(middle, { first: 0, last: frameCount - 1 }, 900);
    canvas.dispatchEvent(pointer('pointerdown', x, EVENTS_ROW_Y));
    canvas.dispatchEvent(pointer('pointerup', x, EVENTS_ROW_Y));
    const seen = selectionSeen(harness.step);
    expect(seen.card).toBe(target.id);
    expect(seen.row).toContain(`frame ${target.startFrame}`);
    expect(seen.line).toContain(`hole ${target.holeIndex}`);
  });

  it('says how to revert every correction it applies', () => {
    press(harness.step, 'e');
    const ev = events().find((e) => e.id === selectionSeen(harness.step).card)!;
    const select = harness.step.body.querySelector<HTMLSelectElement>('select[aria-label="Hole of the selected event"]')!;
    const moved = ((ev.holeIndex ?? 0) + 1) % 20;
    select.value = String(moved);
    select.dispatchEvent(new Event('change'));
    expect(harness.said.at(-1)).toContain(`Hole changed from ${ev.holeIndex} to ${moved}`);
    expect(harness.said.at(-1)).toContain('revert it with “Revert to automatic” in the Corrections list');
  });

  it('comes back after a reload, and a remembered event that is gone is dropped', () => {
    press(harness.step, 'e');
    const before = selectionSeen(harness.step);
    harness.step.body.remove();
    document.body.replaceChildren();
    const again = mount(harness.store.current, { keepSelection: true });
    expect(selectionSeen(again.step).line).toBe(before.line);

    sessionStorage.setItem(
      `barnestrack:selected-event:${again.store.current.sessionId}:${again.store.videos[0]!.id}`,
      'auto-investigation-h3-f999999',
    );
    again.step.body.remove();
    document.body.replaceChildren();
    const third = mount(again.store.current, { keepSelection: true });
    expect(selectionSeen(third.step).line).toMatch(/^Nothing selected/);
  });
});

/*
 * D67 in the interface: the detector's escape entry is an inference a person can keep, reject or
 * reclassify. The fixture's second and third videos end in an entry.
 */
describe('an escape entry is an inference', () => {
  let harness: Harness;

  beforeEach(() => {
    document.body.replaceChildren();
    harness = mount();
  });

  /** Shows the first video with an escape entry and selects that entry by clicking its card. */
  function selectEntry(): { videoId: string; entry: EventRecord } {
    for (const video of harness.store.videos) {
      const entry = harness.store.analysisFor(video.id)?.derived?.events.find((e) => e.kind === 'escape_entry');
      if (!entry) continue;
      const select = harness.step.body.querySelector<HTMLSelectElement>('.review-top select')!;
      select.value = video.id;
      select.dispatchEvent(new Event('change'));
      harness.step.body
        .querySelector<HTMLButtonElement>(`#review-events li[data-event-id="${entry.id}"] .event-card`)!
        .click();
      return { videoId: video.id, entry };
    }
    throw new Error('the fixture has no escape entry');
  }

  const entries = (videoId: string) => harness.store.analysisFor(videoId)!.corrections.entries;

  it('reads "Inferred escape entry" on the card, in the table and in the selection line', () => {
    const { entry } = selectEntry();
    const card = harness.step.body.querySelector(`#review-events li[data-event-id="${entry.id}"] .event-kind`)!;
    expect(card.textContent).toBe('Inferred escape entry ');
    const row = harness.step.body.querySelector('#review-events-mirror tr.is-selected th button')!;
    expect(row.textContent).toBe('Inferred escape entry');
    expect(harness.step.body.querySelector('#review-selection-line')!.textContent).toContain('Selected: inferred escape entry');
    expect(harness.step.body.querySelector('#review-selected .event-evidence')!.textContent).toMatch(/^Inferred — /);
  });

  it('Keep writes the confirmed edit, and the export says confirmed = true', () => {
    const { videoId, entry } = selectEntry();
    const keep = [...harness.step.body.querySelectorAll<HTMLButtonElement>('#review-selected button')].find(
      (b) => b.textContent === 'Keep (K)',
    )!;
    expect(keep.disabled).toBe(false);
    keep.click();
    analyseAllVideos(harness.store);
    harness.step.refresh();

    expect(entries(videoId)).toContainEqual(
      expect.objectContaining({ kind: 'event', action: 'edit', eventId: entry.id, confirmed: true }),
    );
    const after = harness.store.analysisFor(videoId)!.derived!.events.find((e) => e.id === entry.id)!;
    expect(after.confirmed).toBe(true);
    expect(after.kind).toBe('escape_entry');
    const row = eventRows(harness.store.current, TOOL_VERSION).find((r) => r.videoId === videoId && r.eventId === entry.id)!;
    expect(row.confirmed).toBe(true);
    // The table's label is read from `confirmed`, and the card names it.
    const source = [...harness.step.body.querySelectorAll('#review-events-mirror tbody tr')]
      .find((tr) => tr.querySelector('th button')?.getAttribute('aria-label')?.includes(`frame ${entry.startFrame}`))!
      .querySelectorAll('td')[8]!.textContent;
    expect(source).toBe('auto · confirmed, no change');
    expect(harness.step.body.querySelector(`#review-events li[data-event-id="${entry.id}"] .event-kind`)!.textContent).toBe(
      'Escape entry — confirmed ',
    );
  });

  it('L reclassifies it as tracking loss with one edit carrying newKind', () => {
    const { videoId, entry } = selectEntry();
    press(harness.step, 'l');
    analyseAllVideos(harness.store);
    harness.step.refresh();
    expect(entries(videoId)).toContainEqual(
      expect.objectContaining({ kind: 'event', action: 'edit', eventId: entry.id, newKind: 'tracking_failure' }),
    );
    const after = harness.store.analysisFor(videoId)!.derived!.events.find((e) => e.id === entry.id)!;
    expect(after.kind).toBe('tracking_failure');
    expect(harness.step.body.querySelector(`#review-events li[data-event-id="${entry.id}"] .event-kind`)!.textContent).toBe(
      'Tracking loss — reclassified by you ',
    );
  });

  it('the button on the entry card writes the same edit', () => {
    const { videoId, entry } = selectEntry();
    const button = [
      ...harness.step.body.querySelectorAll<HTMLButtonElement>(`#review-events li[data-event-id="${entry.id}"] button`),
    ].find((b) => b.textContent === 'Not an entry — tracking loss (L)')!;
    button.click();
    expect(entries(videoId)).toContainEqual(
      expect.objectContaining({ kind: 'event', action: 'edit', eventId: entry.id, newKind: 'tracking_failure' }),
    );
  });

  it('L on anything else says why and writes nothing', () => {
    const video = harness.store.videos[0]!;
    const before = entries(video.id);
    press(harness.step, 'e');
    press(harness.step, 'l');
    expect(entries(video.id)).toBe(before);
    expect(harness.said.at(-1)).toContain('Only an escape entry the tracker inferred can be reclassified');
  });

  it('names the count per video in the selector', () => {
    const select = harness.step.body.querySelector('.review-top select')!;
    const options = [...select.querySelectorAll('option')].map((o) => o.textContent);
    expect(options.length).toBeGreaterThan(1);
    for (const label of options) expect(label).toMatch(/ — (nothing to check|\d+ events? to check)$/);
  });
});

describe('the timeline legend', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('names every pattern the timeline draws, in words beside a swatch', () => {
    const step = mount().step;
    const legend = step.body.querySelector('.timeline-legend')!;
    expect(legend).not.toBeNull();
    const entries = [...legend.querySelectorAll('li')].map((li) => li.textContent);
    expect(entries).toEqual([
      'tracked',
      'low confidence',
      'ambiguous',
      'not detected',
      'filled by cleaning',
      'corrected by hand',
      'trial start / end',
    ]);
    // Every word has a swatch, and no swatch is announced twice.
    for (const li of legend.querySelectorAll('li')) {
      const swatch = li.querySelector('.legend-swatch')!;
      expect(swatch.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('sits inside the timeline, under the canvas and its controls', () => {
    const step = mount().step;
    const timeline = step.body.querySelector('.timeline')!;
    expect(timeline.querySelector('.timeline-legend')).not.toBeNull();
    expect(timeline.lastElementChild!.classList.contains('timeline-legend')).toBe(true);
  });
});

/*
 * D63 in the Trial group. The fixture's first video never escapes, which is
 * exactly the trial this control exists for: it reads `review` until a person
 * says the animal genuinely never went in.
 */
describe('confirming that a trial had no escape', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = mount();
    // The fixture ships a hand-edited event on this video whose flag is a
    // review reason of its own, and D63 deliberately does not clear those. This
    // block is about the escape rule, so it starts from the automatic layer.
    harness.store.setCorrections(harness.store.videos[0]!.id, NO_CORRECTIONS);
    analyseAllVideos(harness.store);
    harness.step.refresh();
  });

  afterEach(() => {
    harness.step.body.remove();
  });

  const field = (): HTMLElement => harness.step.body.querySelector<HTMLElement>('.no-escape-field')!;
  const box = (): HTMLInputElement => field().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  const reason = (): HTMLInputElement => field().querySelector<HTMLInputElement>('.text-input')!;
  const hint = (): string => field().querySelector('.hint')!.textContent!;

  /** The note beside one row of the metrics card, by the row's visible name. */
  function metricNote(name: string): string {
    const row = [...harness.step.body.querySelectorAll('#review-metrics .metric-row')].find(
      (candidate) => candidate.querySelector('.metric-name')?.textContent === name,
    )!;
    return row.querySelector('.metric-note')?.textContent ?? '';
  }

  function metricValue(name: string): string {
    const row = [...harness.step.body.querySelectorAll('#review-metrics .metric-row')].find(
      (candidate) => candidate.querySelector('.metric-name')?.textContent === name,
    )!;
    return row.querySelector('.metric-value')!.textContent!;
  }

  function confirm(text: string): void {
    reason().value = text;
    box().click();
    analyseAllVideos(harness.store);
    harness.step.refresh();
  }

  it('turns a non-escaper from review into ok, and says who said so', () => {
    expect(metricValue('Status')).toBe('review');
    // The reason is not optional: ticking without one refuses and says why.
    box().click();
    expect(box().checked).toBe(false);
    expect(field().querySelector('.error')!.textContent).toContain('Say why');
    expect(harness.store.analysisFor(harness.store.videos[0]!.id)!.corrections.entries).toEqual([]);

    confirm('watched it to the end; it sat by hole 3');
    expect(metricValue('Status')).toBe('ok');
    expect(metricNote('Status')).toContain('Non-escape confirmed by the user');
    expect(metricNote('Status')).toContain('it sat by hole 3');
    expect(metricValue('Escaped')).toBe('no');
    expect(metricValue('Total latency')).toBe('—');
    // and it is a correction like any other: listed, with its own revert
    expect(harness.step.body.querySelector('.corrections-list')!.textContent).toContain(
      'Confirmed: the animal never entered the escape box',
    );
  });

  it('is contradicted, not overruled, when an escape entry turns up afterwards', () => {
    confirm('nothing went in');
    expect(metricValue('Status')).toBe('ok');

    // A range correction asserting the escape box to the end of the clip: the
    // entry the confirmation says does not exist.
    const video = harness.store.videos[0]!;
    harness.store.setCorrections(
      video.id,
      markRange(harness.store.analysisFor(video.id)!.corrections, 'in_escape_box', 2000, 100_000, {
        id: 'test-escape-range',
        timestamp: '2026-09-07T12:00:00.000Z',
      }),
    );
    analyseAllVideos(harness.store);
    harness.step.refresh();

    expect(metricValue('Escaped')).toBe('yes'); // the entry wins
    expect(metricValue('Status')).toBe('review');
    expect(metricNote('Status')).toContain('contradicting the confirmation');
    // and the card does not assert the confirmation one row above the contradiction
    expect(metricNote('Escaped')).not.toContain('confirmed by the user');
    // The confirmation is still on file and still the user's to withdraw.
    expect(box().checked).toBe(true);
    expect(box().disabled).toBe(false);
    expect(hint()).toContain('Contradicted');
  });

  it('keeps a reason typed but not yet ticked across an unrelated re-render', () => {
    // Typing the reason and then going back to the video to check it is the
    // normal order of work; a render that blanked the field lost the sentence.
    reason().value = 'I watched every second of this';
    harness.step.refresh();
    expect(reason().value).toBe('I watched every second of this');
  });

  it('re-commits the reason when it is edited, without a second correction', () => {
    confirm('nothing went in');
    const video = harness.store.videos[0]!;
    const before = harness.store.analysisFor(video.id)!.corrections.entries[0]!;

    reason().value = 'nothing went in — checked again at 2x';
    reason().dispatchEvent(new Event('change'));
    analyseAllVideos(harness.store);
    harness.step.refresh();

    const after = harness.store.analysisFor(video.id)!.corrections.entries;
    expect(after).toHaveLength(1); // coalesced: the correction keeps its identity
    expect(after[0]!.id).toBe(before.id);
    expect(after[0]).toMatchObject({ kind: 'no_escape', reason: 'nothing went in — checked again at 2x' });
    expect(metricNote('Status')).toContain('checked again at 2x');
    // An emptied reason is not a way to erase the reason on a standing correction.
    reason().value = '   ';
    reason().dispatchEvent(new Event('change'));
    expect(reason().value).toBe('nothing went in — checked again at 2x');
  });

  /** Shows test53, whose automatic escape entry runs from frame 851 to the end of the clip. */
  function showTest53(): string {
    const video = harness.store.videos[2]!;
    const select = harness.step.body.querySelector<HTMLSelectElement>('.review-top select')!;
    select.value = video.id;
    select.dispatchEvent(new Event('change'));
    return video.id;
  }

  it('is disabled beside an entry that ended the trial, and says so', () => {
    showTest53();
    expect(box().disabled).toBe(true);
    expect(hint()).toContain('ended the trial');
    expect(hint()).toContain('reclassify it as tracking loss (L)');
  });

  it('is enabled beside an entry too short to end the trial, and says the entry stays', () => {
    const videoId = showTest53();
    // The animal is seen again at the hole it was lost at, from frame 890: the entry (851–889,
    // about 1.3 s) is over the minimum duration and under the persist cutoff.
    const track = harness.store.analysisFor(videoId)!.derived!.cleanedTrack;
    const atHole = track[848]!.centroid;
    let layer = harness.store.analysisFor(videoId)!.corrections;
    for (let f = 890; f < track.length; f++) {
      layer = setPoint(layer, f, 'centroid', { x: atHole.x, y: atHole.y, confidence: 1, valid: true }, { id: `seen-${f}`, timestamp: '2026-10-20T12:00:00.000Z' });
    }
    harness.store.setCorrections(videoId, layer);
    analyseAllVideos(harness.store);
    harness.step.refresh();
    const entry = harness.store.analysisFor(videoId)!.derived!.events.find((e) => e.kind === 'escape_entry');
    expect(entry, 'the fixture no longer yields a short entry').toBeDefined();
    expect(harness.store.analysisFor(videoId)!.derived!.metrics.escaped).toBe(false);

    expect(box().disabled).toBe(false);
    expect(hint()).toContain('too short to end the trial, so it stays');
    expect(hint()).toContain('non_persistent_entry_noted');

    confirm('it put its head in and came straight back out');
    const derived = harness.store.analysisFor(videoId)!.derived!;
    expect(derived.reviewFlags.map((flag) => flag.code)).toContain('non_persistent_entry_noted');
    expect(derived.events.some((e) => e.kind === 'escape_entry')).toBe(true); // the entry stays
  });

  it('goes back to review when the confirmation is unticked', () => {
    confirm('nothing went in');
    expect(metricValue('Status')).toBe('ok');

    box().click();
    analyseAllVideos(harness.store);
    harness.step.refresh();

    expect(box().checked).toBe(false);
    expect(metricValue('Status')).toBe('review');
    expect(harness.store.analysisFor(harness.store.videos[0]!.id)!.corrections.entries).toEqual([]);
    expect(harness.step.body.querySelector('.corrections-list')!.textContent).not.toContain(
      'never entered the escape box',
    );
  });
});
