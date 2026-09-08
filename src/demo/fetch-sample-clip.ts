/**
 * The one outbound request BarnesTrack ever makes (D2).
 *
 * D2 is "zero runtime network requests" with a single, user-initiated
 * exception: a button that downloads one small clip from the public sample-data
 * repository so the example cohort can be driven frame by frame. Nothing here
 * runs on its own — no prefetch, no preconnect, no request on page load. The
 * button says the file, the size and the source before it does anything, which
 * is what lets the data-handling text point at this module and stop.
 *
 * The download is verified against the example session's *own* descriptor
 * rather than a hash written here, so the bundle and the clip can never drift
 * apart: if Monday's take re-records the cohort, verification follows it.
 */
import type { VideoDescriptor, VideoFingerprint } from '../contracts/session.js';
import type { SessionStore } from '../session/session-store.js';
import { fingerprintsMatch } from '../session/attach.js';
import { inspectFile } from '../session/intake.js';
import { sha256OfSource } from '../video/fingerprint.js';
import { byteSourceFromBlob } from '../video/byte-source.js';
import { FrameSource } from '../video/frame-source.js';

/** The smallest of the three clips: 905 frames, 30 fps, 0:30, 496,723 bytes. */
export const SAMPLE_CLIP_FILENAME = 'test53.mp4';

export const SAMPLE_CLIP_URL =
  'https://raw.githubusercontent.com/salk-airc/rse-takehome-2026/main/data/barnes-maze/test53.mp4';

/** Says the file, the size and the source before the request is made. */
export const FETCH_BUTTON_LABEL = 'Fetch test53.mp4 (≈ 0.5 MB) from the sample-data repository';

export interface SampleClip {
  filename: string;
  url: string;
  /** Exact size, from the example bundle's own descriptors. */
  byteLength: number;
}

/**
 * The three clips of the example cohort, with the sizes the confirmation
 * dialog quotes before any request is made (D2). The numbers are the
 * `fingerprint.byteLength` of the bundle's own descriptors; a file that no
 * longer matches is caught by `verifyAgainstDescriptor`, not by this table.
 */
export const SAMPLE_CLIPS: readonly SampleClip[] = [
  { filename: 'test50.mp4', url: sampleClipUrl('test50.mp4'), byteLength: 2_333_495 },
  { filename: 'test51.mp4', url: sampleClipUrl('test51.mp4'), byteLength: 455_830 },
  { filename: 'test53.mp4', url: sampleClipUrl('test53.mp4'), byteLength: 496_723 },
];

export const SAMPLE_CLIPS_TOTAL_BYTES = SAMPLE_CLIPS.reduce(
  (total, clip) => total + clip.byteLength,
  0,
);

function sampleClipUrl(filename: string): string {
  return `https://raw.githubusercontent.com/salk-airc/rse-takehome-2026/main/data/barnes-maze/${filename}`;
}

export const FETCH_BUTTON_HINT =
  'This is the only time BarnesTrack contacts the network. It downloads one video ' +
  'from raw.githubusercontent.com into this browser and checks it against the ' +
  'example cohort before using it. Nothing is uploaded.';

const OFFLINE_MESSAGE =
  'Could not reach the sample-data repository. Check your connection, or download ' +
  'test53.mp4 yourself and drop it on the Videos step instead.';

export interface FetchProgress {
  receivedBytes: number;
  /** Null when the server sends no `content-length`. */
  totalBytes: number | null;
}

export type FetchLike = (input: string) => Promise<Response>;

export interface FetchSampleClipOptions {
  fetchImpl?: FetchLike;
  url?: string;
  onProgress?: (progress: FetchProgress) => void;
}

export type FetchSampleClipResult =
  | { kind: 'ok'; file: File }
  | { kind: 'failed'; message: string };

export type VerifyResult =
  | { kind: 'verified'; fingerprint: VideoFingerprint }
  | { kind: 'mismatch'; message: string };

/** A body longer than the descriptor says it should be; the read is abandoned. */
class OversizedDownloadError extends Error {
  constructor(maxBytes: number) {
    super(`the response is longer than the expected ${maxBytes} bytes`);
    this.name = 'OversizedDownloadError';
  }
}

/**
 * Streams the body so the button can show progress on a slow lab connection.
 * `content-length` is absent often enough that a null total is a normal state,
 * not an error.
 */
async function readWithProgress(
  response: Response,
  maxBytes: number,
  onProgress?: (progress: FetchProgress) => void,
): Promise<Uint8Array> {
  const header = response.headers.get('content-length');
  const totalBytes = header === null ? null : Number(header);
  const body = response.body;

  if (body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ receivedBytes: bytes.byteLength, totalBytes });
    return bytes;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    receivedBytes += value.byteLength;
    // The expected size is known from the descriptor, and the hash check only
    // happens once the whole body is in memory. Stop a mis-served or hostile
    // response at the known length instead of buffering it all first.
    if (receivedBytes > maxBytes) {
      await reader.cancel();
      throw new OversizedDownloadError(maxBytes);
    }
    chunks.push(value);
    onProgress?.({ receivedBytes, totalBytes });
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Checks downloaded bytes against the descriptor the example cohort carries.
 * `fingerprintsMatch` compares byte length and SHA-256, which is exactly the
 * test the re-attach path applies to a dropped file (D27).
 */
export async function verifyAgainstDescriptor(
  bytes: Uint8Array,
  descriptor: VideoDescriptor,
): Promise<VerifyResult> {
  const blob = new Blob([bytes as BlobPart]);
  const sha256 = await sha256OfSource(blob);
  const fingerprint: VideoFingerprint = {
    byteLength: bytes.byteLength,
    durationSeconds: descriptor.fingerprint.durationSeconds,
    frameCount: descriptor.fingerprint.frameCount,
    sha256,
  };

  if (!fingerprintsMatch(fingerprint, descriptor.fingerprint)) {
    return {
      kind: 'mismatch',
      message:
        `The downloaded file is not the ${descriptor.filename} this example cohort was ` +
        'built from, so it was discarded. The repository may have changed it.',
    };
  }
  return { kind: 'verified', fingerprint };
}

/** Downloads and verifies. Never touches the store — attaching is a separate step. */
export async function fetchSampleClip(
  descriptor: VideoDescriptor,
  options: FetchSampleClipOptions = {},
): Promise<FetchSampleClipResult> {
  const fetchImpl = options.fetchImpl ?? ((input: string) => fetch(input));
  const url = options.url ?? SAMPLE_CLIP_URL;

  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch {
    // An offline or blocked request rejects with a TypeError carrying no
    // useful detail, so the user gets the sentence rather than the error.
    return { kind: 'failed', message: OFFLINE_MESSAGE };
  }

  if (!response.ok) {
    return {
      kind: 'failed',
      message: `The sample-data repository answered ${response.status}. ${OFFLINE_MESSAGE}`,
    };
  }

  let bytes: Uint8Array;
  try {
    bytes = await readWithProgress(
      response,
      descriptor.fingerprint.byteLength,
      options.onProgress,
    );
  } catch (error) {
    if (error instanceof OversizedDownloadError) {
      return {
        kind: 'failed',
        message:
          `The download was larger than the ${descriptor.filename} this example cohort ` +
          'expects, so it was stopped and discarded.',
      };
    }
    return { kind: 'failed', message: `The download did not finish. ${OFFLINE_MESSAGE}` };
  }

  const verified = await verifyAgainstDescriptor(bytes, descriptor);
  if (verified.kind === 'mismatch') {
    return { kind: 'failed', message: verified.message };
  }

  return {
    kind: 'ok',
    file: new File([bytes as BlobPart], descriptor.filename, { type: 'video/mp4' }),
  };
}

export type AttachResult =
  | { kind: 'attached'; descriptor: VideoDescriptor }
  | { kind: 'failed'; message: string };

/**
 * Re-attaches through the normal path: parse the sample table, match the
 * fingerprint against the session, attach. The clip is never added as a fourth
 * video — a fetched file that does not match a descriptor is a bug, not a new
 * recording, and is reported rather than absorbed.
 */
export async function attachFetchedClip(store: SessionStore, file: File): Promise<AttachResult> {
  const result = await inspectFile(file);
  if (result.kind === 'rejected') {
    return { kind: 'failed', message: result.reason };
  }

  const { index, fingerprint } = result;
  const existing = store.matchFingerprint(fingerprint);
  if (existing === undefined) {
    return {
      kind: 'failed',
      message: `${file.name} does not match any video in this session, so it was not attached.`,
    };
  }

  store.attach(existing.id, {
    file,
    index,
    frameSource: new FrameSource(index, byteSourceFromBlob(file)),
  });
  return { kind: 'attached', descriptor: existing };
}
