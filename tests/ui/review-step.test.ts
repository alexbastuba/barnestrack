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
import type { SessionFile } from '../../src/contracts/session.js';
import { analyseAllVideos } from '../../src/session/analyse.js';
import { NO_CORRECTIONS, confirmedEventIds, editEvent, markRange } from '../../src/session/corrections.js';
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

function mount(session: SessionFile = syntheticSession()): Harness {
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
    expect(step.body.querySelector<HTMLButtonElement>('#review-export button')!.disabled).toBe(false);
    expect(step.body.querySelector<HTMLElement>('#review-export .figure-missing')!.hidden).toBe(true);
  });

  it('puts the caches back after a maze nudge, so the export stays available', () => {
    const harness = mount();
    const first = harness.store.videos[0]!;

    harness.store.setMazeTransform(first.id, { ...first.mazeTransform, rotationDeg: 3 });

    expect(harness.store.videos.map((v) => harness.store.analysisFor(v.id)?.derived ?? null)).not.toContain(null);
    expect(panel(harness.step, 'review-export').querySelector<HTMLButtonElement>('button')!.disabled).toBe(false);
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
    // Directly under the video and the toolbar, and still above the timeline.
    expect(bar.previousElementSibling!.classList.contains('review-stage')).toBe(true);
    expect(bar.nextElementSibling!.classList.contains('timeline')).toBe(true);
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

    const keep = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')].find(
      (b) => b.textContent === 'Keep (K)',
    )!;
    expect(keep.disabled).toBe(false);
    keep.click();

    // One fewer to check, and the event is the user's with the automatic values intact.
    expect(queued().length).toBe(before.length - 1);
    expect(count()).toBe(describeQueue(before.length - 1));
    const after = harness.store.analysisFor(video.id)!.derived!.events.find((e) => e.id === kept.id)!;
    expect(after.source).toBe('corrected');
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
    expect(row.source).toBe('corrected');

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

  it('refuses to keep an escape entry or a tracking failure, whose numbers would be recomputed', () => {
    const video = harness.store.videos[0]!;
    const other = harness.store
      .analysisFor(video.id)!
      .derived!.events.find((e) => e.kind !== 'investigation');
    expect(other, 'the fixture has no non-investigation event').toBeDefined();

    // Selecting it the way the mirror table does.
    const row = [...harness.step.body.querySelectorAll<HTMLButtonElement>('#review-events-mirror th button')].find(
      (b) => b.getAttribute('aria-label')?.includes(`frame ${other!.startFrame}`),
    )!;
    row.click();

    const keep = [...harness.step.body.querySelectorAll<HTMLButtonElement>('.queue-step')].find(
      (b) => b.textContent === 'Keep (K)',
    )!;
    expect(keep.disabled).toBe(true);
    expect(keep.title).toContain('cannot be kept');
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
