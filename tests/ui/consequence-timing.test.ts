/**
 * The cost of the queue's consequences on the example cohort (chunk 17, §2.1):
 * one re-derive per queued event of test50, the longest clip (5,539 frames),
 * from the shipped bundle. The mean is gated under 50 ms per event; the max
 * is printed, not gated, because a CI runner's variance is not a defect.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derive, type DeriveInput } from '../../src/analysis/derive.js';
import { parseSessionDocument } from '../../src/session/session-file.js';
import { eventsToCheck } from '../../src/ui/review-queue.js';
import { consequenceTiming, consequencesFor } from '../../src/ui/review-reasons.js';
import { stateRuns } from '../../src/viz/quality-strip.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_PATH = join(REPO_ROOT, 'public/examples/example-cohort.barnestrack.json.gz');
/** The D22 budget per derive, applied to the mean consequence (Alex's ruling for chunk 17). */
const BUDGET_MS = 50;

describe('consequence timing on the example cohort', () => {
  it('re-derives every queued event of test50 in under 50 ms each on average (count, mean and max printed)', () => {
    const parsed = parseSessionDocument(gunzipSync(readFileSync(BUNDLE_PATH)).toString('utf-8'));
    if (!parsed.ok) throw new Error(parsed.message);
    const session = parsed.session;
    const video = session.videos.find((v) => v.filename === 'test50.mp4')!;
    expect(video).toBeDefined();
    const analysis = session.analyses[video.id]!;
    const input: DeriveInput = {
      videoId: video.id,
      auto: analysis.auto,
      corrections: analysis.corrections,
      mazeMap: session.mazeMap!,
      mazeTransform: video.mazeTransform,
      index: video.referenceResolution,
      parameters: session.parameters!,
      trialType: video.trialType,
      targetHole: video.targetHole,
    };
    const derived = derive(input);
    const queue = eventsToCheck(derived.events, derived.reviewFlags, stateRuns(derived.cleanedTrack));
    expect(queue.length).toBeGreaterThan(0);
    const consequences = consequencesFor(input, derived, queue);
    const timing = consequenceTiming(consequences, queue);
    console.log(
      `consequences on test50 (${derived.cleanedTrack.length} frames): ${timing.count} queued events, mean ${timing.mean.toFixed(1)} ms, max ${timing.max.toFixed(1)} ms, total ${timing.total.toFixed(0)} ms`,
    );
    expect(timing.count).toBe(queue.length);
    expect(timing.mean).toBeLessThan(BUDGET_MS);
    for (const id of queue) expect(consequences.get(id)!.sentence).toMatch(/^If rejected: /);
  });
});
