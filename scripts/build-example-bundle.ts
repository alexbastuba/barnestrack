/**
 * Builds the bundled example cohort the "Load example cohort" button loads (D33).
 *
 *   npx tsx scripts/build-example-bundle.ts
 *
 * For this chunk the analysis comes from the synthetic fixture, so the numbers
 * are plausible rather than real; Monday's demo take replaces `sourceSession()`
 * with the real outputs and nothing else here changes. The loader never assumes
 * anything about the numbers — it validates the shape and adopts the document.
 *
 * The fingerprints, however, must be real. `fingerprintsMatch` compares
 * `byteLength` and `sha256`, so a session carrying the fixture's invented
 * fingerprints could never accept the clip the fetch button downloads. They are
 * computed from the sample videos when `BARNESTRACK_SAMPLE_DIR` points at them,
 * and otherwise taken from the values recorded below.
 *
 * Output is gzipped: serialized the way the app writes a session file it is
 * 11,608,385 bytes (11.1 MiB; 5.7 MB with the whitespace stripped), and the
 * pre-commit guard refuses any staged blob over 2 MB. Gzipped it is ~491 kB.
 * See docs/known-limitations.md.
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SessionFile, VideoDescriptor, VideoFingerprint } from '../src/contracts/session.js';
import { parseSessionDocument, serializeSessionFile } from '../src/session/session-file.js';
import { hashParameters, hashTrackingParameters } from '../src/analysis/parameters.js';
import { fingerprintVideo } from '../src/video/fingerprint.js';
import { parseMp4Index } from '../src/video/mp4-index.js';
import {
  FIXTURE_PARAMETERS_HASH,
  FIXTURE_TRACKING_HASH,
  syntheticSession,
} from '../tests/fixtures/synthetic-analysis.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_PATH = join(REPO_ROOT, 'public/examples/example-cohort.barnestrack.json.gz');

/** The name the loader looks for to know the example cohort is already loaded. */
export const EXAMPLE_SESSION_NAME = 'Example cohort';

/**
 * Measured from `data/barnes-maze/` in the sample-data repository, and checked
 * against the bytes `raw.githubusercontent.com` serves for the same paths. The
 * fetch button verifies a download against these, so they are the contract
 * between this bundle and that request.
 */
export const SAMPLE_FINGERPRINTS: Record<string, VideoFingerprint> = {
  'test50.mp4': {
    byteLength: 2333495,
    durationSeconds: 185.06666666666666,
    frameCount: 5539,
    sha256: '654e98559f5a81b964316487a457b206915a3ad9b084c7944c1afda3186fff87',
  },
  'test51.mp4': {
    byteLength: 455830,
    durationSeconds: 49.382666666666665,
    frameCount: 741,
    sha256: '6e62674589c8915fa6b6cf1fc78ba8e9a0b29fec6086817d6ad2dd14493a6743',
  },
  'test53.mp4': {
    byteLength: 496723,
    durationSeconds: 30.233333333333334,
    frameCount: 905,
    sha256: '351e85627241debbe7b2624d84e1c7ce97086db04fed215305019cb358d4d571',
  },
};

/** Swap this for the real take's session when the demo pass is recorded. */
function sourceSession(): SessionFile {
  return syntheticSession();
}

/**
 * Reads the real fingerprint off disk. Keeps `durationSeconds`/`frameCount`
 * honest too, even though only `byteLength` and `sha256` decide a match.
 */
async function fingerprintFromDisk(path: string): Promise<VideoFingerprint> {
  const bytes = readFileSync(path);
  const blob = new Blob([new Uint8Array(bytes)]);
  const index = await parseMp4Index(blob);
  return fingerprintVideo(blob, index);
}

async function realFingerprints(): Promise<Record<string, VideoFingerprint>> {
  const sampleDir = process.env['BARNESTRACK_SAMPLE_DIR'];
  if (sampleDir === undefined) {
    console.log('build-example-bundle: BARNESTRACK_SAMPLE_DIR unset, using the recorded values.');
    return SAMPLE_FINGERPRINTS;
  }
  const measured: Record<string, VideoFingerprint> = {};
  for (const filename of Object.keys(SAMPLE_FINGERPRINTS)) {
    const path = join(sampleDir, filename);
    if (!existsSync(path)) {
      throw new Error(`build-example-bundle: ${path} does not exist.`);
    }
    const seen = await fingerprintFromDisk(path);
    measured[filename] = seen;
    // The whole fingerprint, not just the hash: a recorded duration that drifts
    // from what the parser reports would make the build depend on whether the
    // sample directory happened to be set, which is how the two got out of step
    // the first time.
    const recorded = SAMPLE_FINGERPRINTS[filename];
    if (recorded !== undefined && JSON.stringify(seen) !== JSON.stringify(recorded)) {
      throw new Error(
        `build-example-bundle: ${filename} measures ${JSON.stringify(seen)}, but the recorded ` +
          `value is ${JSON.stringify(recorded)}. Update SAMPLE_FINGERPRINTS deliberately.`,
      );
    }
  }
  console.log('build-example-bundle: fingerprints measured from BARNESTRACK_SAMPLE_DIR.');
  return measured;
}

function withRealFingerprints(
  videos: readonly VideoDescriptor[],
  fingerprints: Record<string, VideoFingerprint>,
): VideoDescriptor[] {
  return videos.map((video) => {
    const real = fingerprints[video.filename];
    if (real === undefined) {
      throw new Error(`build-example-bundle: no recorded fingerprint for ${video.filename}.`);
    }
    return { ...video, fingerprint: real };
  });
}

/**
 * Replaces the fixture's two placeholder hash constants with real ones.
 *
 * Deliberately narrow. `FIXTURE_TRACKING_HASH` and `FIXTURE_PARAMETERS_HASH` are
 * not the hash of anything, and shipping them would mean a `trials.csv` exported
 * from the demo disagreeing with the `parameters.json` beside it (D11, D12).
 * But restamping *every* hash unconditionally would be just as wrong for the
 * real take: under D51 a session tracked with one set of tracking parameters and
 * re-derived under another legitimately carries `auto.parametersHash` that does
 * not match `parameters.tracking`, and that disagreement is precisely the
 * "needs a re-track" signal chunk 6 reads. Overwriting it would destroy the
 * provenance rather than record it.
 *
 * So only these two exact placeholders are substituted. Anything else that does
 * not hash out is left alone for `assertHashesAreReal` to reject.
 */
function withoutPlaceholderHashes(session: SessionFile): SessionFile {
  const parameters = session.parameters;
  if (parameters === null) {
    throw new Error('build-example-bundle: the source session has no parameters to hash.');
  }
  const trackingHash = hashTrackingParameters(parameters.tracking);
  const fullHash = hashParameters(parameters);

  const analyses: SessionFile['analyses'] = {};
  for (const [videoId, analysis] of Object.entries(session.analyses)) {
    const auto =
      analysis.auto.parametersHash === FIXTURE_TRACKING_HASH
        ? { ...analysis.auto, parametersHash: trackingHash }
        : analysis.auto;

    let derived = analysis.derived;
    if (derived !== null && derived.quality.parametersHash === FIXTURE_PARAMETERS_HASH) {
      derived = { ...derived, quality: { ...derived.quality, parametersHash: fullHash } };
    }
    analyses[videoId] = { ...analysis, auto, derived };
  }
  return { ...session, analyses };
}

/** Exported so the bundle test asserts the same property the build does. */
export function hashProblems(session: SessionFile): string[] {
  const parameters = session.parameters;
  if (parameters === null) return ['the session carries no parameters'];

  const trackingHash = hashTrackingParameters(parameters.tracking);
  const fullHash = hashParameters(parameters);
  const problems: string[] = [];

  for (const [videoId, analysis] of Object.entries(session.analyses)) {
    if (analysis.auto.parametersHash !== trackingHash) {
      problems.push(
        `${videoId}: auto.parametersHash is ${analysis.auto.parametersHash}, ` +
          `but parameters.tracking hashes to ${trackingHash}`,
      );
    }
    const quality = analysis.derived?.quality;
    if (quality !== undefined && quality.parametersHash !== fullHash) {
      problems.push(
        `${videoId}: derived.quality.parametersHash is ${quality.parametersHash}, ` +
          `but parameters hashes to ${fullHash}`,
      );
    }
  }
  return problems;
}

function assertHashesAreReal(session: SessionFile): void {
  const problems = hashProblems(session);
  if (problems.length > 0) {
    throw new Error(`build-example-bundle: unreconcilable hashes —\n  ${problems.join('\n  ')}`);
  }
}

export async function buildExampleSession(): Promise<SessionFile> {
  const source = sourceSession();
  const fingerprints = await realFingerprints();
  const session = withoutPlaceholderHashes({
    ...source,
    name: EXAMPLE_SESSION_NAME,
    videos: withRealFingerprints(source.videos, fingerprints),
  });

  // After placeholder substitution and before anything is written: a hash that
  // still does not reconcile is a real disagreement in the source, and the
  // build stops rather than papering over it. This is what makes the check
  // meaningful for Monday's take, whose hashes are not placeholders.
  assertHashesAreReal(session);
  return session;
}

async function main(): Promise<void> {
  const session = await buildExampleSession();
  const text = serializeSessionFile(session);

  // The bundle has to survive the same parser the "Load session file" path
  // uses, or the button ships a document the app would reject.
  const parsed = parseSessionDocument(text);
  if (!parsed.ok) {
    throw new Error(`build-example-bundle: the generated session is not valid — ${parsed.message}`);
  }

  const gzipped = gzipSync(Buffer.from(text, 'utf-8'), { level: 9 });
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, gzipped);

  const plainKb = Math.round(Buffer.byteLength(text) / 1024);
  const gzipKb = Math.round(gzipped.byteLength / 1024);
  console.log(
    `build-example-bundle: ${session.videos.length} videos, ${plainKb} kB of JSON, ` +
      `${gzipKb} kB gzipped -> ${OUT_PATH}`,
  );
}

// Only when run as a script: the tests import `buildExampleSession` and
// `SAMPLE_FINGERPRINTS` from here, and importing must not rebuild the bundle.
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main();
}
