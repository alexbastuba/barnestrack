// @vitest-environment happy-dom
/**
 * The Review step when the consequence pass throws (chunk 17 FIX).
 *
 * "What changes if this event is wrong" is one re-derive per queued event, run
 * eagerly inside the step's derive (`ensureAnalysis`). It is a what-if: when it
 * fails, the trial's own events and metrics must stand — the pass shared the
 * derive's `try`, so a throw there nulled the analysis and every panel read
 * "No analysis yet." for a trial that had been analysed correctly.
 *
 * `consequencesFor` is replaced with one that throws; everything else in
 * `review-reasons.ts` is the real module.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hashParameters } from '../../src/analysis/parameters.js';
import { analyseAllVideos } from '../../src/session/analyse.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { CHANGE_DEBOUNCE_MS } from '../../src/ui/components/index.js';
import { eventsToCheck } from '../../src/ui/review-queue.js';
import type * as ReviewReasons from '../../src/ui/review-reasons.js';
import { createReviewStep } from '../../src/ui/review-step.js';
import type { AppContext, Step } from '../../src/ui/step.js';
import { stateRuns } from '../../src/viz/quality-strip.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

const FAILURE = 'the what-if derive failed on purpose';

vi.mock('../../src/ui/review-reasons.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ReviewReasons>();
  return {
    ...actual,
    consequencesFor: vi.fn(() => {
      throw new Error(FAILURE);
    }),
  };
});

const TOOL_VERSION = 'barnestrack v0.1.0 (rev0000)';
const ANNOUNCED = 'What each event to check would change could not be computed';

interface Harness {
  store: SessionStore;
  step: Step;
  said: string[];
}

function mount(): Harness {
  sessionStorage.clear();
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(syntheticSession());
  analyseAllVideos(store);
  const said: string[] = [];
  const context: AppContext = {
    store,
    toolVersion: TOOL_VERSION,
    announce: (message) => said.push(message),
    showStep: () => undefined,
  };
  const step = createReviewStep(context);
  document.body.append(step.body);
  store.subscribe(() => step.refresh());
  step.refresh();
  return { store, step, said };
}

describe('a consequence pass that throws leaves the analysis standing', () => {
  let harness: Harness;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.replaceChildren();
    // The failure is logged for a developer; the assertion below reads it rather than letting it through.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    harness = mount();
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleError.mockRestore();
  });

  const text = (selector: string): string => harness.step.body.querySelector(selector)?.textContent ?? '';

  it('still shows the events, the metrics, the queue and the timing readout', () => {
    expect(text('#review-events .event-count')).toMatch(/^\d+ investigations? · \d+ escape entr(y|ies) · \d+ tracking failures?$/);
    expect(harness.step.body.querySelectorAll('#review-metrics .metric-row').length).toBeGreaterThan(0);
    expect(harness.step.body.textContent).not.toContain('No analysis yet.');
    const video = harness.store.videos[0]!;
    const derived = harness.store.analysisFor(video.id)!.derived!;
    const queued = eventsToCheck(derived.events, derived.reviewFlags, stateRuns(derived.cleanedTrack));
    expect(queued.length).toBeGreaterThan(0);
    expect(text('#review-current-event .queue-count')).toMatch(new RegExp(`^${queued.length} to check · \\d+ checked$`));
    // The readout has the derive and no consequence figure: none was computed.
    expect(text('.review-timing')).toMatch(/ · derive [\d.]+ ms \(/);
    expect(text('.review-timing')).not.toContain('consequence');
  });

  it('says so, once per derive, and never as a failed analysis', () => {
    const announced = harness.said.filter((message) => message.startsWith(ANNOUNCED));
    expect(announced).toHaveLength(1);
    expect(announced[0]).toContain(FAILURE);
    expect(announced[0]).toContain('The events and the metrics are not affected.');
    expect(harness.said.some((message) => message.startsWith('The analysis could not be computed'))).toBe(false);
    expect(consoleError).toHaveBeenCalled();

    // The analysis is cached as any other: an idle re-render neither retries the pass nor repeats the message.
    harness.step.refresh();
    harness.step.refresh();
    expect(harness.said.filter((message) => message.startsWith(ANNOUNCED))).toHaveLength(1);
  });

  it('keeps the reason on every queued card and prints no consequence', () => {
    const video = harness.store.videos[0]!;
    const derived = harness.store.analysisFor(video.id)!.derived!;
    const queued = new Set(eventsToCheck(derived.events, derived.reviewFlags, stateRuns(derived.cleanedTrack)));
    let seen = 0;
    for (const item of harness.step.body.querySelectorAll<HTMLElement>('#review-events li.event-item')) {
      const id = item.getAttribute('data-event-id')!;
      if (!queued.has(id)) continue;
      seen++;
      expect(item.querySelector('.event-reason')?.textContent, id).toMatch(/^(Flagged: |Decided over \d+ uncertain frames? of \d+: )/);
      expect(item.querySelector('.event-consequence'), id).toBeNull();
    }
    expect(seen).toBe(queued.size);
  });

  it('still walks the queue and still re-derives on a threshold change', () => {
    harness.step.body
      .querySelector<HTMLElement>('.timeline-surface')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true }));
    expect(harness.step.body.querySelector('#review-selected .event-item')).not.toBeNull();

    const hashBefore = hashParameters(harness.store.parameters);
    const row = [...harness.step.body.querySelectorAll<HTMLElement>('#review-parameters .param-row')].find(
      (candidate) => candidate.querySelector('label')!.textContent === 'Merge gap',
    )!;
    const input = row.querySelector<HTMLInputElement>('input[type="number"]')!;
    input.value = '1';
    input.dispatchEvent(new Event('input'));
    vi.advanceTimersByTime(CHANGE_DEBOUNCE_MS + 1);

    const expected = hashParameters(harness.store.parameters);
    expect(expected).not.toBe(hashBefore);
    expect(harness.step.body.querySelector('#review-quality')!.textContent).toContain(expected);
    expect(text('#review-events .event-count')).toMatch(/investigation/);
    expect(harness.step.body.textContent).not.toContain('No analysis yet.');
  });
});
