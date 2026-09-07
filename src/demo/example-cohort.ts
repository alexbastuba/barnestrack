/**
 * "Load example cohort" (D33): a bundled, precomputed session for the three
 * sample videos, so every result renders within a minute of opening the page
 * and without a video attached.
 *
 * No DOM here on purpose — the loader is a pure-ish function over the session
 * store, unit-tested in Node, and `example-cohort-ui.ts` mounts it.
 *
 * Nothing is assumed about the numbers in the bundle. This chunk generates it
 * from the synthetic fixture and Monday's demo take replaces it with real
 * outputs; the loader validates the document's *shape* with the same parser the
 * "Load session file" path uses, and adopts it unchanged.
 *
 * The videos arrive in the existing "not attached" state: the bundle carries
 * descriptors and analyses but no file, so `store.isAttached(id)` is false for
 * all three and the Videos step already renders "video not attached" with the
 * re-attach hint. No new state was invented for the demo.
 */
import type { SessionFile } from '../contracts/session.js';
import type { SessionStore } from '../session/session-store.js';
import { fingerprintsMatch } from '../session/attach.js';
import { parseSessionDocument } from '../session/session-file.js';

/** The session name the bundle carries, and the marker that it is already loaded. */
export const EXAMPLE_SESSION_NAME = 'Example cohort';

/**
 * Gzipped: the document is 11.1 MiB of JSON and the repository's pre-commit
 * guard refuses any staged blob over 2 MB. See `scripts/build-example-bundle.ts`.
 */
export const EXAMPLE_BUNDLE_PATH = 'examples/example-cohort.barnestrack.json.gz';

export const SAMPLE_REPO_URL = 'https://github.com/salk-airc/rse-takehome-2026';
export const SAMPLE_DATA_URL = `${SAMPLE_REPO_URL}/tree/main/data/barnes-maze`;

/**
 * The banner shown while the example cohort has no video attached. Every result
 * is already on screen; what needs the file is frame-level work.
 */
export const EXAMPLE_BANNER_TEXT =
  'Frames and manual correction need the video file: drop test53.mp4 from the ' +
  'sample-data repository, or fetch the smallest clip below.';

/**
 * Said on screen, not only in the docs.
 *
 * The cohort names three real recordings and carries their real fingerprints,
 * frame counts and stills, so every number beside them reads as this tool's
 * output on that data. Until the demo take replaces the bundle, the numbers are
 * not: they are illustrative. A limitation recorded only in
 * `docs/known-limitations.md` is not disclosed to the person looking at the
 * screen, and "honest uncertainty over plausible lies" (D16) is about what the
 * tool shows.
 *
 * Reword this in the commit that swaps in the real outputs — do not delete it.
 * The line should then describe that run rather than disappear: where the
 * numbers came from is worth saying whether or not they are illustrative, and
 * the two tests that assert this string move with it.
 */
export const EXAMPLE_PROVENANCE_TEXT =
  'These results are illustrative, not a real tracking run of these clips.';

export type FetchLike = (input: string) => Promise<Response>;

export interface ExampleLoaderOptions {
  /** Injected in tests; defaults to the page's `fetch`. */
  fetchImpl?: FetchLike;
  /** Injected in tests; defaults to the document base so the build's `base: './'` holds. */
  baseUrl?: string;
  /**
   * Asked before replacing a session that already holds videos. Returning false
   * cancels, and so does leaving this out: a caller with no way to ask cannot
   * consent on the user's behalf, so the loader refuses rather than overwriting
   * work it was never given permission to destroy (D27).
   */
  confirmReplace?: () => boolean | Promise<boolean>;
}

export type LoadExampleResult =
  | { kind: 'loaded'; session: SessionFile }
  | { kind: 'already-loaded' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

function baseFor(options: ExampleLoaderOptions): string {
  if (options.baseUrl !== undefined) return options.baseUrl;
  return typeof document !== 'undefined' ? document.baseURI : './';
}

/** `test53.mp4` → the derived still that lets figures draw without the video. */
export function exampleStillUrl(filename: string, options: ExampleLoaderOptions = {}): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  return new URL(`examples/${stem}.jpg`, baseFor(options)).href;
}

const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Gunzips when the bytes are gzip, and decodes as text when they are not.
 *
 * Both branches are real. A static host that serves `.gz` with
 * `Content-Encoding: gzip` makes `fetch` decode the body already, and the page
 * then receives plain JSON; without the sniff the demo would work locally and
 * break only once deployed.
 */
export async function decodeBundleBytes(bytes: Uint8Array): Promise<string> {
  const isGzip = bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
  if (!isGzip) return new TextDecoder().decode(bytes);

  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This browser cannot decompress the example cohort (no DecompressionStream).');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** Fetches, decompresses and validates the bundle. Throws with a sentence a user can read. */
export async function fetchExampleSession(
  options: ExampleLoaderOptions = {},
): Promise<SessionFile> {
  const fetchImpl = options.fetchImpl ?? ((input: string) => fetch(input));
  const url = new URL(EXAMPLE_BUNDLE_PATH, baseFor(options)).href;

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    throw new Error('Could not read the bundled example cohort from this page.');
  }
  if (!response.ok) {
    throw new Error(`Could not read the bundled example cohort (HTTP ${response.status}).`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = await decodeBundleBytes(bytes);

  // The same parser the "Load session file" path uses, so a corrupt bundle
  // produces the message the user already knows.
  const parsed = parseSessionDocument(text);
  if (!parsed.ok) {
    throw new Error(`The bundled example cohort could not be read: ${parsed.message}`);
  }
  return parsed.session;
}

/**
 * True when the store already holds this exact example cohort: same name, same
 * videos, same content. Compared on fingerprints rather than filenames for the
 * same reason re-attach is (D27) — the name alone is not identity.
 */
export function isSameExampleCohort(current: SessionFile, bundle: SessionFile): boolean {
  if (current.name !== bundle.name) return false;
  // A rebuilt bundle is a different cohort even with the same three videos.
  // Without this, someone who loaded the synthetic cohort before the demo take
  // would click "Load example cohort", be told it is already loaded, and keep
  // the old numbers forever — the videos and the name are identical across a
  // rebuild, and only the tool version moves.
  if (current.toolVersion !== bundle.toolVersion) return false;
  if (current.videos.length !== bundle.videos.length) return false;
  return current.videos.every((video, position) => {
    const other = bundle.videos[position];
    return other !== undefined && fingerprintsMatch(video.fingerprint, other.fingerprint);
  });
}

/**
 * Loads the example cohort into the store.
 *
 * Idempotent: loading it twice leaves one session and does not bump the store's
 * epoch, so the UI does not flicker and nothing is re-adopted.
 *
 * Never overwrites unasked: a session that already holds videos and is not this
 * cohort goes through `confirmReplace` first.
 */
export async function loadExampleCohort(
  store: SessionStore,
  options: ExampleLoaderOptions = {},
): Promise<LoadExampleResult> {
  let bundle: SessionFile;
  try {
    bundle = await fetchExampleSession(options);
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }

  if (isSameExampleCohort(store.current, bundle)) {
    return { kind: 'already-loaded' };
  }

  // A session with videos in it is someone's work. Replacing it needs an
  // answer, and a caller that supplies no way to ask does not get to guess:
  // the default is to refuse, not to proceed.
  if (store.videos.length > 0) {
    if (options.confirmReplace === undefined) return { kind: 'cancelled' };
    const proceed = await options.confirmReplace();
    if (!proceed) return { kind: 'cancelled' };
  }

  store.replaceSession(bundle);
  return { kind: 'loaded', session: bundle };
}
