/**
 * A2 (trust audit): the shipped example cohort's derived layers must be
 * *derived*, not scripted.
 *
 * The bundle used to carry the synthetic fixture's plausible-looking metrics
 * with the real parameters hash stamped on them, so the demo's numbers differed
 * from what the same tool computes from the same track — `trialStart_s 2.4 → 0`,
 * `escaped true → false`, `tier REVIEW → GOOD` — with the same hash on both
 * sides of every arrow.
 *
 * This re-derives every video of the *committed* document (not the builder's
 * in-memory output: `tests/demo/bundle.test.ts` already ties those together)
 * and asserts the shipped layer is field-for-field what `derive()` produces.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derive, toDerivedLayer } from '../../src/analysis/derive.js';
import { hashParameters } from '../../src/analysis/parameters.js';
import { parseSessionDocument } from '../../src/session/session-file.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { hashProblems } from '../../scripts/build-example-bundle.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_PATH = join(REPO_ROOT, 'public/examples/example-cohort.barnestrack.json.gz');

/**
 * The one difference a JSON round trip legitimately makes: a derived number
 * that cannot be computed is `NaN` in memory and `null` in the file, and
 * consumers treat the two alike (`isRecorded`, docs/known-limitations.md). The
 * comparison below is field-for-field under that convention, not under
 * `Object.is`.
 */
function asWritten<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function committedSession(): SessionFile {
  const text = gunzipSync(readFileSync(BUNDLE_PATH)).toString('utf-8');
  const parsed = parseSessionDocument(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.session;
}

describe('the committed example cohort is reproducible from its own automatic layer (A2)', () => {
  const session = committedSession();

  it('has a maze map, parameters and a derived layer for every video', () => {
    expect(session.mazeMap).not.toBeNull();
    expect(session.parameters).not.toBeNull();
    expect(session.videos.length).toBeGreaterThan(0);
    for (const video of session.videos) {
      expect(session.analyses[video.id]?.derived, `${video.filename} has no derived layer`).toBeDefined();
      expect(session.analyses[video.id]!.derived).not.toBeNull();
    }
  });

  it('re-derives each video to the layer the bundle ships', () => {
    const mazeMap = session.mazeMap;
    const parameters = session.parameters;
    if (mazeMap === null || parameters === null) throw new Error('the bundle carries no map');

    for (const video of session.videos) {
      const analysis = session.analyses[video.id]!;
      const rederived = toDerivedLayer(
        derive({
          videoId: video.id,
          auto: analysis.auto,
          corrections: analysis.corrections,
          mazeMap,
          mazeTransform: video.mazeTransform,
          index: {
            width: video.referenceResolution.width,
            height: video.referenceResolution.height,
          },
          parameters,
        }),
      );
      const fresh = asWritten(rederived);
      // Named first so a failure says which number moved, then the whole layer.
      expect(analysis.derived!.metrics, `${video.filename} metrics`).toEqual(fresh.metrics);
      expect(analysis.derived!.quality, `${video.filename} quality`).toEqual(fresh.quality);
      expect(analysis.derived!.events, `${video.filename} events`).toEqual(fresh.events);
      expect(analysis.derived!, `${video.filename} derived layer`).toEqual(fresh);
    }
  });

  it('stamps every derived layer with the hash of the parameters it ships', () => {
    const full = hashParameters(session.parameters!);
    for (const video of session.videos) {
      expect(session.analyses[video.id]!.derived!.quality.parametersHash).toBe(full);
    }
    expect(hashProblems(session)).toEqual([]);
  });
});
