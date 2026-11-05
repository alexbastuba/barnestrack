/**
 * Why an event is queued and what it costs if it is wrong (chunk 17): the
 * sentences, the rank that orders the queue, and the cache. Against real
 * `derive()` output, never a hand-written record.
 */
import { describe, expect, it } from 'vitest';
import { derive } from '../../src/analysis/derive.js';
import type { ReviewFlag } from '../../src/analysis/types.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import { deleteEvent } from '../../src/session/corrections.js';
import { eventsToCheck } from '../../src/ui/review-queue.js';
import {
  FLAG_LABELS,
  consequenceOf,
  consequenceTiming,
  consequencesFor,
  flagLabel,
  reasonFor,
} from '../../src/ui/review-reasons.js';
import { stateRuns } from '../../src/viz/quality-strip.js';
import { deriveInputFor, fixture } from './components/fixture.js';

/** A frame with only what `reasonFor` reads. */
function frame(frameIndex: number, detectionState: TrackFrame['detectionState'], reason: string): TrackFrame {
  return { frameIndex, detectionState, reason } as unknown as TrackFrame;
}

const flag = (eventId: string, code: ReviewFlag['code']): ReviewFlag => ({ code, eventId, message: 'the message' });

describe('reasonFor', () => {
  const event = { id: 'ev', startFrame: 10, endFrame: 20 };

  it('names the flag(s) when one names the event, by label, each once', () => {
    expect(reasonFor(event, [flag('ev', 'physically_unlikely_entry')], [])).toBe('Flagged: physically unlikely.');
    expect(
      reasonFor(event, [flag('ev', 'tracking_failure_at_hole'), flag('ev', 'tracking_failure_at_hole'), flag('ev', 'orphaned_correction')], []),
    ).toBe('Flagged: lost at a hole · orphaned correction.');
    // another event's flag is not this event's reason
    expect(reasonFor(event, [flag('other', 'physically_unlikely_entry')], [])).toBeNull();
  });

  it('counts the uncertain frames of the span by state and reason, by frame index, in the span only', () => {
    const frames: TrackFrame[] = [];
    for (let f = 0; f <= 30; f++) frames.push(frame(f, 'tracked', 'single_blob'));
    // inside the span: 3 low-confidence (2 fragmented, 1 small_blob), 2 not detected; outside: ignored
    frames[11] = frame(11, 'low_confidence', 'fragmented');
    frames[12] = frame(12, 'low_confidence', 'fragmented');
    frames[13] = frame(13, 'low_confidence', 'small_blob');
    frames[15] = frame(15, 'not_detected', 'no_blob');
    frames[16] = frame(16, 'not_detected', 'no_blob');
    frames[25] = frame(25, 'ambiguous', 'multiple_blobs');
    expect(reasonFor(event, [], frames)).toBe(
      'Decided over 5 uncertain frames of 11: 3 low confidence (2 fragmented, 1 small blob), 2 not detected (2 no blob).',
    );
    // one uncertain frame reads in the singular; none reads as not queued
    expect(reasonFor({ id: 'x', startFrame: 25, endFrame: 26 }, [], frames)).toBe(
      'Decided over 1 uncertain frame of 2: 1 ambiguous (1 multiple blobs).',
    );
    expect(reasonFor({ id: 'x', startFrame: 0, endFrame: 9 }, [], frames)).toBeNull();
  });

  it('reads frames by frameIndex, not by array position', () => {
    // the array holds frames 100…110 at positions 0…10
    const frames: TrackFrame[] = [];
    for (let f = 100; f <= 110; f++) frames.push(frame(f, f === 105 ? 'not_detected' : 'tracked', f === 105 ? 'no_blob' : 'single_blob'));
    expect(reasonFor({ id: 'x', startFrame: 104, endFrame: 106 }, [], frames)).toBe(
      'Decided over 1 uncertain frame of 3: 1 not detected (1 no blob).',
    );
    expect(reasonFor({ id: 'x', startFrame: 4, endFrame: 6 }, [], frames)).toBeNull();
  });

  it('labels every flag code, and only the O4 finding "physically unlikely"', () => {
    expect(flagLabel('physically_unlikely_entry')).toBe('physically unlikely');
    expect(Object.values(FLAG_LABELS).filter((label) => label === 'physically unlikely')).toHaveLength(1);
  });
});

describe('consequenceOf', () => {
  // test50 never escapes; the third synthetic video ends in an inferred entry
  const noEscape = fixture('video-test50', { corrections: [] });
  const noEscapeInput = deriveInputFor(noEscape.session, 'video-test50', { corrections: [] });
  const escapes = fixture('video-test53', { corrections: [] });
  const escapesInput = deriveInputFor(escapes.session, 'video-test53', { corrections: [] });

  it('says what rejecting an escape entry does to the trial: latency, escaped, status — ranked trial-ending', () => {
    const entry = escapes.analysis.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry, 'the fixture has no entry').toBeDefined();
    expect(escapes.analysis.trial.endReason).toBe('escape');
    const c = consequenceOf(entry, escapesInput, escapes.analysis);
    expect(c.rank).toBe('trial_end');
    expect(c.sentence).toMatch(/^If rejected: total latency \d+\.\d s → (cutoff|end of video); escaped yes → no; status \w+ → \w+/);
    // the sentence is what the engine says: the same derive, with the entry deleted
    const rejected = derive({ ...escapesInput, corrections: deleteEvent(escapesInput.corrections, entry.id, { id: 'x', timestamp: '2026-09-06T10:00:00.000Z' }) });
    expect(rejected.metrics.escaped).toBe(false);
    expect(c.sentence).toContain(`status ${escapes.analysis.metrics.status} → ${rejected.metrics.status}`);
    expect(c.ms).toBeGreaterThanOrEqual(0);
  });

  it('says what rejecting a non-target investigation does to the errors, and that the strategy stands — ranked error-changing', () => {
    const investigation = noEscape.analysis.events.find((e) => e.kind === 'investigation' && !e.isTarget)!;
    const c = consequenceOf(investigation, noEscapeInput, noEscape.analysis);
    const before = noEscape.analysis.metrics.totalErrors!;
    expect(c.sentence).toMatch(new RegExp(`^If rejected: total errors ${before} → ${before - 1}(; primary errors \\d+ → \\d+)?; strategy (unchanged|\\w+ → \\w+)\\.$`));
    expect(['errors', 'strategy']).toContain(c.rank);
    if (c.rank === 'errors') expect(c.sentence).toMatch(/strategy unchanged\.$/);
    else expect(c.sentence).toMatch(/strategy \w+ → \w+\.$/);
  });

  it('says that rejecting a tracking failure changes no number — ranked last', () => {
    const loss = noEscape.analysis.events.find((e) => e.kind === 'tracking_failure')!;
    expect(loss, 'the fixture has no tracking failure').toBeDefined();
    const c = consequenceOf(loss, noEscapeInput, noEscape.analysis);
    expect(c.rank).toBe('none');
    expect(c.sentence).toBe('If rejected: no number changes.');
  });

  it('computes each queued event once per analysis object, skips an id the analysis has no event for, and times the lot', () => {
    const queue = eventsToCheck(noEscape.analysis.events, noEscape.analysis.reviewFlags, stateRuns(noEscape.analysis.cleanedTrack));
    expect(queue.length).toBeGreaterThan(1);
    let ticks = 0;
    const clock = (): number => (ticks += 1);
    const first = consequencesFor(noEscapeInput, noEscape.analysis, [...queue, 'not-an-event'], clock);
    expect([...first.keys()]).toEqual(queue);
    const calls = ticks;
    const again = consequencesFor(noEscapeInput, noEscape.analysis, queue, clock);
    expect(again).toBe(first);
    expect(ticks).toBe(calls); // nothing re-derived
    for (const id of queue) expect(again.get(id)).toBe(first.get(id));
    const timing = consequenceTiming(first, queue);
    expect(timing.count).toBe(queue.length);
    expect(timing.max).toBe(1); // the fake clock advances one tick per derive
    expect(timing.mean).toBe(1);
    expect(timing.total).toBe(queue.length);
    // a fresh derive is a fresh object: computed again
    const fresh = derive(noEscapeInput);
    expect(consequencesFor(noEscapeInput, fresh, queue, clock)).not.toBe(first);
    expect(ticks).toBeGreaterThan(calls);
  });
});
