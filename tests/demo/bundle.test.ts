/**
 * The committed example bundle (D33). What matters is that the artifact in
 * `public/examples/` is a document the app's own loader would accept, and that
 * it carries the *real* fingerprints of the sample videos — a session with the
 * fixture's invented ones could never accept the clip the fetch button
 * downloads, and the failure would only show up in a browser.
 *
 * Deliberately no assertion about a metric's value: Monday's demo take replaces
 * the synthetic analysis with real outputs, and this file must not need editing
 * when it does.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SESSION_SCHEMA_VERSION, type SessionFile } from '../../src/contracts/session.js';
import { parseSessionDocument } from '../../src/session/session-file.js';
import { fingerprintsMatch } from '../../src/session/attach.js';
import { hashParameters } from '../../src/analysis/parameters.js';
import { trialRows } from '../../src/export/rows.js';
import { DETECTION_REASONS } from '../../src/analysis/tracker/select.js';
import {
  EXAMPLE_SESSION_NAME,
  SAMPLE_FINGERPRINTS,
  buildExampleSession,
  hashProblems,
} from '../../scripts/build-example-bundle.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const BUNDLE_PATH = join(REPO_ROOT, 'public/examples/example-cohort.barnestrack.json.gz');
const STILLS = ['test50.jpg', 'test51.jpg', 'test53.jpg'];

/** The guard in `.claude/hooks/pre-commit-guard.sh`. */
const COMMIT_BLOB_LIMIT_BYTES = 2 * 1024 * 1024;
const STILL_LIMIT_BYTES = 60 * 1024;

/**
 * The prose the synthetic fixture writes where the contract wants one of the
 * tracker's eight names. Recorded in docs/known-limitations.md; goes away with
 * the demo take, since the real tracker emits DETECTION_REASONS.
 */
const KNOWN_OFF_CONTRACT_REASONS = [
  'single mouse-sized component inside the platform mask',
  'blob smaller than half the expected body area (small_blob)',
  'component larger than three times the expected body area (oversized_blob)',
  'no foreground component above the area prior',
  'foreground component below the area prior for two frames',
  'no foreground component inside the platform mask (last seen at the target hole)',
];

function committedSessionText(): string {
  return gunzipSync(readFileSync(BUNDLE_PATH)).toString('utf-8');
}

describe('the committed example bundle', () => {
  it('is gzip, not plain JSON', () => {
    const raw = readFileSync(BUNDLE_PATH);
    expect([raw[0], raw[1]]).toEqual([0x1f, 0x8b]);
  });

  it('stays under the size the pre-commit guard allows', () => {
    expect(statSync(BUNDLE_PATH).size).toBeLessThan(COMMIT_BLOB_LIMIT_BYTES);
  });

  it('parses with the same parser the "Load session file" path uses', () => {
    const parsed = parseSessionDocument(committedSessionText());
    expect(parsed.ok).toBe(true);
  });

  it('is a three-video cohort named for the button that loads it', () => {
    const parsed = parseSessionDocument(committedSessionText());
    if (!parsed.ok) throw new Error(parsed.message);

    expect(parsed.session.name).toBe(EXAMPLE_SESSION_NAME);
    expect(parsed.session.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(parsed.session.videos.map((video) => video.filename)).toEqual([
      'test50.mp4',
      'test51.mp4',
      'test53.mp4',
    ]);
  });

  it('carries the real fingerprints of the sample videos, so a fetched clip can attach', () => {
    const parsed = parseSessionDocument(committedSessionText());
    if (!parsed.ok) throw new Error(parsed.message);

    for (const video of parsed.session.videos) {
      const real = SAMPLE_FINGERPRINTS[video.filename];
      expect(real, `no recorded fingerprint for ${video.filename}`).toBeDefined();
      // fingerprintsMatch is exactly what the re-attach path uses.
      expect(fingerprintsMatch(video.fingerprint, real!)).toBe(true);
    }
  });

  it('renders without a video: every video has a tracked layer to draw from', () => {
    const parsed = parseSessionDocument(committedSessionText());
    if (!parsed.ok) throw new Error(parsed.message);

    expect(parsed.session.mazeMap).not.toBeNull();
    expect(parsed.session.parameters).not.toBeNull();
    for (const video of parsed.session.videos) {
      const analysis = parsed.session.analyses[video.id];
      expect(analysis, `no analysis for ${video.filename}`).toBeDefined();
      expect(analysis!.auto.frames.length).toBeGreaterThan(0);
    }
  });

  it('stamps hashes that are the hashes of the parameters it carries', () => {
    const parsed = parseSessionDocument(committedSessionText());
    if (!parsed.ok) throw new Error(parsed.message);

    // Not a restatement of the builder: this recomputes from the shipped
    // document with the app's own hasher. A fabricated hash makes trials.csv
    // disagree with the parameters.json in the same export (D11, D12, D51).
    expect(hashProblems(parsed.session)).toEqual([]);
  });

  it('exports a parameters hash that reconciles with its own parameters', () => {
    const parsed = parseSessionDocument(committedSessionText());
    if (!parsed.ok) throw new Error(parsed.message);
    const parameters = parsed.session.parameters;
    if (parameters === null) throw new Error('the example cohort has no parameters');

    const stamped = [...new Set(trialRows(parsed.session).map((row) => row.parametersHash))];

    expect(stamped).toEqual([hashParameters(parameters)]);
  });

  it('has a recorded reason on every frame, and no new off-contract ones', () => {
    const parsed = parseSessionDocument(committedSessionText());
    if (!parsed.ok) throw new Error(parsed.message);

    const seen = new Set<string>();
    for (const analysis of Object.values(parsed.session.analyses)) {
      for (const frame of analysis.auto.frames) {
        expect(frame.reason, 'every frame carries a reason (D16)').not.toBe('');
        seen.add(frame.reason);
      }
    }

    // data-contracts.md §2 fixes the vocabulary to the tracker's own eight. The
    // synthetic fixture writes prose instead; the real tracker already emits
    // DETECTION_REASONS, so the demo take resolves this with no code change.
    // Pinned to the exact known sentences rather than asserted away: new prose
    // fails here, and when the last one disappears this test fails too, which
    // is the signal to delete it along with the known-limitations entry.
    const offContract = [...seen].filter(
      (reason) => !(DETECTION_REASONS as readonly string[]).includes(reason),
    );
    expect(
      [...offContract].sort(),
      'off-contract reasons changed — if they are gone, delete this test and the ' +
        'known-limitations entry that records them',
    ).toEqual([...KNOWN_OFF_CONTRACT_REASONS].sort());
  });

  it('detects a hash that does not reconcile, so the guard is not vacuous', async () => {
    const built = await buildExampleSession();
    const [videoId, analysis] = Object.entries(built.analyses)[0]!;

    // Neither a placeholder nor the real value — what a real take with a
    // genuine mismatch would carry. hashProblems must see it, or the build's
    // assertion protects nothing.
    const tampered: SessionFile = {
      ...built,
      analyses: {
        ...built.analyses,
        [videoId]: { ...analysis, auto: { ...analysis.auto, parametersHash: 'f'.repeat(64) } },
      },
    };

    expect(hashProblems(built)).toEqual([]);
    expect(hashProblems(tampered)).toHaveLength(1);
    expect(hashProblems(tampered)[0]).toContain(videoId);
  });

  it('matches what the builder produces now, so the artifact is not stale', async () => {
    const rebuilt = await buildExampleSession();
    const committed = parseSessionDocument(committedSessionText());
    if (!committed.ok) throw new Error(committed.message);

    // Compared as parsed documents: key order is not part of the contract.
    expect(committed.session).toEqual(rebuilt);
  });
});

describe('the committed stills', () => {
  it.each(STILLS)('%s is present and within the 60 KB budget', (name) => {
    const size = statSync(join(REPO_ROOT, 'public/examples', name)).size;
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(STILL_LIMIT_BYTES);
  });
});
