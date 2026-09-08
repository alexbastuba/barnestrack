/**
 * The review queue's rule: which events want a human, and what takes one out
 * of the queue again (D19, D24).
 */
import { describe, expect, it } from 'vitest';
import type { ReviewFlag } from '../../src/analysis/types.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { StateRun } from '../../src/viz/quality-strip.js';
import {
  describeQueue,
  eventsToCheck,
  spanIsUncertain,
  stepQueue,
} from '../../src/ui/review-queue.js';

function event(id: string, startFrame: number, endFrame: number, source: 'auto' | 'corrected' = 'auto'): EventRecord {
  return {
    id,
    kind: 'investigation',
    holeIndex: 3,
    isTarget: false,
    startFrame,
    endFrame,
    startTime_s: startFrame / 30,
    endTime_s: endFrame / 30,
    durationSeconds: (endFrame - startFrame + 1) / 30,
    pointUsed: 'nose',
    minNoseDistance_cm: 2,
    minCentroidDistance_cm: 4,
    evidence: '',
    source,
  };
}

function run(state: StateRun['state'], startFrame: number, endFrame: number): StateRun {
  return { state, startFrame, endFrame, startTime_s: startFrame / 30, endTime_s: endFrame / 30 };
}

const flag = (eventId: string): ReviewFlag => ({
  code: 'physically_unlikely_entry',
  message: 'the animal crossed the platform faster than it can run',
  eventId,
});

describe('eventsToCheck', () => {
  it('leaves a clean automatic event out of the queue', () => {
    const runs = [run('tracked', 0, 500)];
    expect(eventsToCheck([event('a', 10, 20)], [], runs)).toEqual([]);
  });

  it('queues an event a review flag names, however well tracked it is', () => {
    const runs = [run('tracked', 0, 500)];
    expect(eventsToCheck([event('a', 10, 20)], [flag('a')], runs)).toEqual(['a']);
  });

  it('queues an event decided over frames the tracker was unsure of', () => {
    const runs = [run('tracked', 0, 99), run('low_confidence', 100, 120), run('tracked', 121, 500)];
    expect(eventsToCheck([event('a', 10, 20), event('b', 110, 115)], [], runs)).toEqual(['b']);
  });

  it('counts ambiguous and not-detected frames too', () => {
    const runs = [run('ambiguous', 0, 10), run('not_detected', 200, 201)];
    const events = [event('a', 5, 8), event('b', 199, 205), event('c', 400, 410)];
    expect(eventsToCheck(events, [], runs)).toEqual(['a', 'b']);
  });

  it('drops an event once it has been corrected, flag or no flag', () => {
    const runs = [run('not_detected', 0, 500)];
    const events = [event('a', 10, 20, 'corrected'), event('b', 30, 40)];
    expect(eventsToCheck(events, [flag('a')], runs)).toEqual(['b']);
  });

  it('counts an event once even when several flags name it', () => {
    const runs = [run('not_detected', 0, 500)];
    const flags: ReviewFlag[] = [flag('a'), { ...flag('a'), code: 'tracking_failure_at_hole' }];
    expect(eventsToCheck([event('a', 10, 20)], flags, runs)).toEqual(['a']);
  });

  it('ignores a flag that names no event', () => {
    const runs = [run('tracked', 0, 500)];
    const frameFlag: ReviewFlag = { code: 'oversized_in_trial', message: 'a hand', frameIndex: 12 };
    expect(eventsToCheck([event('a', 10, 20)], [frameFlag], runs)).toEqual([]);
  });

  it('keeps the events in the order they were given', () => {
    const runs = [run('not_detected', 0, 500)];
    const events = [event('c', 300, 310), event('a', 10, 20), event('b', 100, 110)];
    expect(eventsToCheck(events, [], runs)).toEqual(['c', 'a', 'b']);
  });
});

describe('spanIsUncertain', () => {
  it('catches a run that only touches the span at its last frame', () => {
    expect(spanIsUncertain([run('not_detected', 20, 25)], 10, 20)).toBe(true);
    expect(spanIsUncertain([run('not_detected', 21, 25)], 10, 20)).toBe(false);
  });

  it('catches a run that contains the whole span', () => {
    expect(spanIsUncertain([run('ambiguous', 0, 100)], 40, 50)).toBe(true);
  });
});

describe('stepQueue', () => {
  it('walks forwards and backwards, wrapping at both ends', () => {
    const queue = ['a', 'b', 'c'];
    expect(stepQueue(queue, 'a', 1)).toBe('b');
    expect(stepQueue(queue, 'c', 1)).toBe('a');
    expect(stepQueue(queue, 'a', -1)).toBe('c');
  });

  it('starts at the near end when nothing in the queue is selected', () => {
    expect(stepQueue(['a', 'b'], null, 1)).toBe('a');
    expect(stepQueue(['a', 'b'], null, -1)).toBe('b');
    expect(stepQueue(['a', 'b'], 'somethingElse', 1)).toBe('a');
  });

  it('has nowhere to go in an empty queue', () => {
    expect(stepQueue([], null, 1)).toBeNull();
  });
});

describe('describeQueue', () => {
  it('counts in words, singular and plural', () => {
    expect(describeQueue(0)).toBe('nothing to check');
    expect(describeQueue(1)).toBe('1 event to check');
    expect(describeQueue(4)).toBe('4 events to check');
  });
});
