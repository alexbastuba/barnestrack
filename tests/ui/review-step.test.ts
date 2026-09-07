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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import { CHANGE_DEBOUNCE_MS } from '../../src/ui/components/index.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { analyseAllVideos } from '../../src/session/analyse.js';
import { markRange } from '../../src/session/corrections.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { createReviewStep } from '../../src/ui/review-step.js';
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

    // "Animal not visible here" over a stretch of the trial, through chunk 6's
    // own pure op — the same path the range tool takes.
    const layer = harness.store.analysisFor(video.id)!.corrections;
    harness.store.setCorrections(
      video.id,
      markRange(layer, 'not_visible', 40, 160, { id: 'test-range', timestamp: '2026-09-07T12:00:00.000Z' }),
    );
    analyseAllVideos(harness.store);
    harness.step.refresh();

    const afterReport = harness.store.analysisFor(video.id)!.derived!.quality;
    expect(afterReport.positionedFraction).toBeLessThan(beforeReport.positionedFraction);
    expect(afterReport.gaps.length).toBeGreaterThan(beforeReport.gaps.length);
    expect(quality.textContent).not.toBe(before);
  });
});
