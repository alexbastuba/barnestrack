// Adapted from talmolab/vibes/video-player (BSD-3-Clause, commit d9410fa)
// Adapted from talmolab/vibes/slp-viewer (BSD-3-Clause, commit d9410fa)
/**
 * MP4 sample table → frame identity (D7).
 *
 * A frame is its position in the video track's sample table sorted by
 * presentation time. Its time in seconds is `(cts − editOffsetTicks) /
 * timescale`, never `frameIndex / fps`. Ties in presentation time are ordered
 * by the bitstream's picture order count (the decoder's own display order),
 * then by decode order; see `h264-poc.ts` for why.
 *
 * Borrowed from vibes: sorting the sample table by composition time with the
 * decode index kept alongside, the `avcC` → `description` extraction, and
 * progressive `appendBuffer` parsing of the `moov` box. Re-implemented in
 * TypeScript against mp4box 2.x.
 */
import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';
import type { ISOFile, Movie, Sample, Track, VisualSampleEntry } from 'mp4box';
import { toByteSource, type ByteSource, type ByteSourceInput } from './byte-source.js';
import {
  derivePictureOrder,
  parseAvcC,
  parseFirstSliceHeader,
  type SliceInfo,
} from './h264-poc.js';

export interface FrameEntry {
  /** Position in presentation order. This is `frameIndex` everywhere in the app. */
  presIndex: number;
  /** Position in the sample table (decode order). */
  decodeIndex: number;
  /** Composition time, track timescale ticks, as stored (edit list not applied). */
  cts: number;
  dts: number;
  isKeyframe: boolean;
  byteOffset: number;
  byteLength: number;
  /** Seconds: `max(0, cts − editOffsetTicks) / timescale`. */
  t_s: number;
  /** Picture order count and IDR-period, when the tie-break by POC succeeded. */
  poc?: number;
  gop?: number;
}

export interface TimebaseAnomalies {
  /** Consecutive presentation-order frames with identical composition time. */
  duplicateTimestampPairs: number;
  /** Consecutive frames whose presentation gap exceeds 1.5 × the nominal tick. */
  droppedFrameGaps: number;
  /** `durationSeconds − frameCount / nominalFps`: what nominal-rate arithmetic would be off by at the end. */
  driftSeconds: number;
  /** The most common sample duration, in timescale ticks. */
  nominalTick: number;
}

export type TieBreakRule = 'poc' | 'decode_order';

export interface Mp4Index {
  timescale: number;
  /** `timescale / nominalTick`. Display only; never used for frame time. */
  nominalFps: number;
  width: number;
  height: number;
  /** WebCodecs codec string, e.g. `avc1.640020`. */
  codec: string;
  /** `avcC` box payload for `VideoDecoder.configure({ description })`. */
  description: Uint8Array;
  frameCount: number;
  /** Sum of all sample durations over the timescale. */
  durationSeconds: number;
  /** `elst.media_time` when an edit list is present, else the first composition time. */
  editOffsetTicks: number;
  /** Sorted by presentation time, ties by POC then decode order. `frames[i].presIndex === i`. */
  frames: FrameEntry[];
  keyframePresIndices: number[];
  timebaseAnomalies: TimebaseAnomalies;
  /** The tie-break rule actually applied (`decode_order` when POC could not be read; see `warnings`). */
  tieBreak: TieBreakRule;
  warnings: string[];
  byteLength: number;
}

export interface ParseMp4IndexOptions {
  /** Default `poc`. `decode_order` reproduces a plain sort by composition time then sample number. */
  tieBreak?: TieBreakRule;
}

export class UnsupportedVideoError extends Error {
  override readonly name = 'UnsupportedVideoError';
  constructor(
    message: string,
    /** Plain-language reason shown next to the file in the intake list (O13). */
    readonly reason: string,
  ) {
    super(message);
  }
}

const PARSE_CHUNK_BYTES = 1024 * 1024;
const POC_SCAN_WINDOW_BYTES = 2 * 1024 * 1024;
const DROPPED_GAP_FACTOR = 1.5;

export async function parseMp4Index(
  input: ByteSourceInput,
  options: ParseMp4IndexOptions = {},
): Promise<Mp4Index> {
  const source = toByteSource(input);
  const tieBreakWanted = options.tieBreak ?? 'poc';
  const warnings: string[] = [];

  const { file, movie } = await parseMoov(source);
  const track = movie.videoTracks[0];
  if (!track) throw new UnsupportedVideoError('no video track', 'The file contains no video track.');
  if (movie.videoTracks.length > 1) {
    warnings.push(`file has ${movie.videoTracks.length} video tracks; using track ${track.id}`);
  }
  if (!/^avc[13]\./.test(track.codec)) {
    throw new UnsupportedVideoError(
      `codec ${track.codec} is not H.264`,
      `The video codec is ${track.codec}; only H.264 (AVC) is supported.`,
    );
  }

  const trak = file.getTrackById(track.id);
  const entry = trak.mdia.minf.stbl.stsd.entries[0] as VisualSampleEntry | undefined;
  const avcC = entry?.avcC;
  if (!avcC) {
    throw new UnsupportedVideoError(
      'no avcC box',
      'The H.264 track has no decoder configuration (avcC) box.',
    );
  }
  const description = serialiseBoxPayload(avcC);

  const samples = file.getTrackSamplesInfo(track.id);
  if (!samples || samples.length === 0) {
    throw new UnsupportedVideoError('no samples', 'The video track contains no frames.');
  }

  const timescale = track.timescale;
  const nominalTick = modeOf(samples.map((s) => s.duration));
  const nominalFps = timescale / nominalTick;
  const editOffsetTicks = readEditOffset(track, samples);
  const durationSeconds = samples.reduce((sum, s) => sum + s.duration, 0) / timescale;

  let tieBreak: TieBreakRule = 'decode_order';
  let pictureOrder: { gop: number; poc: number }[] | null = null;
  if (tieBreakWanted === 'poc') {
    const result = await readPictureOrder(source, samples, description);
    if (result.order) {
      pictureOrder = result.order;
      tieBreak = 'poc';
    } else {
      warnings.push(`ties ordered by decode order: ${result.reason}`);
    }
  }

  const order = samples.map((s, i) => ({
    i,
    cts: s.cts,
    gop: pictureOrder?.[i]?.gop ?? 0,
    poc: pictureOrder?.[i]?.poc ?? i,
  }));
  order.sort((a, b) => a.cts - b.cts || a.gop - b.gop || a.poc - b.poc || a.i - b.i);

  const frames: FrameEntry[] = order.map((o, presIndex) => {
    const s = samples[o.i]!;
    const frame: FrameEntry = {
      presIndex,
      decodeIndex: o.i,
      cts: s.cts,
      dts: s.dts,
      isKeyframe: s.is_sync,
      byteOffset: s.offset,
      byteLength: s.size,
      t_s: Math.max(0, s.cts - editOffsetTicks) / timescale,
    };
    if (pictureOrder) {
      frame.poc = o.poc;
      frame.gop = o.gop;
    }
    return frame;
  });

  const keyframePresIndices = frames.filter((f) => f.isKeyframe).map((f) => f.presIndex);
  if (frames[0] && !frames[0].isKeyframe) {
    warnings.push('the first frame in presentation order is not a keyframe');
  }

  const timebaseAnomalies = measureAnomalies(frames, nominalTick, durationSeconds, nominalFps);

  return {
    timescale,
    nominalFps,
    width: track.video?.width ?? entry.width,
    height: track.video?.height ?? entry.height,
    codec: track.codec,
    description,
    frameCount: frames.length,
    durationSeconds,
    editOffsetTicks,
    frames,
    keyframePresIndices,
    timebaseAnomalies,
    tieBreak,
    warnings,
    byteLength: source.byteLength,
  };
}

/** Feeds the file to mp4box in chunks until the `moov` box has been parsed. */
async function parseMoov(source: ByteSource): Promise<{ file: ISOFile; movie: Movie }> {
  const file = createFile(false);
  let movie: Movie | null = null;
  let error: string | null = null;
  file.onReady = (info) => {
    movie = info;
  };
  file.onError = (module, message) => {
    error = `${module}: ${message}`;
  };

  let offset = 0;
  while (offset < source.byteLength && movie === null && error === null) {
    const end = Math.min(offset + PARSE_CHUNK_BYTES, source.byteLength);
    const chunk = await source.read(offset, end);
    const next = file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(chunk, offset), end === source.byteLength);
    if (error !== null) break;
    offset = typeof next === 'number' && next > offset ? next : end;
  }
  if (error !== null) {
    throw new UnsupportedVideoError(
      `mp4box ${error}`,
      'The file is not a readable MP4 (its box structure could not be parsed).',
    );
  }
  if (movie === null) {
    throw new UnsupportedVideoError(
      'moov not found',
      'The file is not a readable MP4 (no movie header was found).',
    );
  }
  return { file, movie };
}

/** Writes a box and returns its payload without the 8-byte box header, as an independent copy. */
function serialiseBoxPayload(box: { write(stream: DataStream): void }): Uint8Array {
  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  box.write(stream);
  const payloadLength = stream.byteLength - 8;
  const copy = new Uint8Array(payloadLength);
  copy.set(new Uint8Array(stream.buffer, 8, payloadLength));
  return copy;
}

function readEditOffset(track: Track, samples: Sample[]): number {
  const edit = track.edits?.find((e) => e.media_time >= 0);
  if (edit) return edit.media_time;
  let first = Infinity;
  for (const s of samples) if (s.cts < first) first = s.cts;
  return first;
}

function modeOf(values: number[]): number {
  const counts = new Map<number, number>();
  let best = values[0] ?? 1;
  let bestCount = 0;
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1;
    counts.set(v, c);
    if (c > bestCount || (c === bestCount && v < best)) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function measureAnomalies(
  frames: FrameEntry[],
  nominalTick: number,
  durationSeconds: number,
  nominalFps: number,
): TimebaseAnomalies {
  let duplicateTimestampPairs = 0;
  let droppedFrameGaps = 0;
  for (let i = 1; i < frames.length; i++) {
    const gap = frames[i]!.cts - frames[i - 1]!.cts;
    if (gap === 0) duplicateTimestampPairs++;
    else if (gap > DROPPED_GAP_FACTOR * nominalTick) droppedFrameGaps++;
  }
  return {
    duplicateTimestampPairs,
    droppedFrameGaps,
    driftSeconds: durationSeconds - frames.length / nominalFps,
    nominalTick,
  };
}

/**
 * Reads the first slice header of every sample (decode order, one sliding
 * window over the file) and derives picture order. Reports why it could not
 * rather than guessing.
 */
async function readPictureOrder(
  source: ByteSource,
  samples: Sample[],
  description: Uint8Array,
): Promise<{ order: { gop: number; poc: number }[] } | { order: null; reason: string }> {
  let cfg;
  try {
    cfg = parseAvcC(description);
  } catch (e) {
    return { order: null, reason: `avcC could not be parsed (${(e as Error).message})` };
  }
  if (cfg.sps.size === 0) return { order: null, reason: 'avcC carries no SPS' };

  const slices: SliceInfo[] = [];
  let windowStart = 0;
  let windowEnd = 0;
  let window: Uint8Array | null = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const sampleEnd = s.offset + s.size;
    if (!window || s.offset < windowStart || sampleEnd > windowEnd) {
      windowStart = s.offset;
      windowEnd = Math.min(source.byteLength, s.offset + Math.max(POC_SCAN_WINDOW_BYTES, s.size));
      window = new Uint8Array(await source.read(windowStart, windowEnd));
    }
    if (sampleEnd > windowEnd) {
      return { order: null, reason: `sample ${i} extends past the end of the file` };
    }
    const bytes = window.subarray(s.offset - windowStart, sampleEnd - windowStart);
    const slice = parseFirstSliceHeader(bytes, cfg);
    if (!slice) return { order: null, reason: `no readable slice header in sample ${i}` };
    slices.push(slice);
  }
  return derivePictureOrder(slices, cfg);
}
