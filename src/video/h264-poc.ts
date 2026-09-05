/**
 * Just enough of the H.264 (AVC) bitstream to recover each picture's
 * picture order count (POC): the codec's own statement of display order.
 *
 * Why this exists (D7): all three sample videos contain pairs of frames with
 * identical composition timestamps. The container cannot order the two
 * frames of such a pair, but the decoder can and does: it emits pictures in
 * POC order. Ordering ties by POC makes the sample-table order equal to the
 * decoder's output order, so frame identity stays "position in the table".
 *
 * Scope: SPS/PPS from the `avcC` box, the slice header up to
 * `pic_order_cnt_lsb`, and the POC type 0 derivation for frame pictures.
 * Anything outside that (POC type 1, field coding) reports `null` so the
 * caller can fall back to decode order explicitly, never silently.
 */

/** Reads unsigned bits and Exp-Golomb codes from an RBSP (emulation bytes already removed). */
export class BitReader {
  private bitPos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get bitsLeft(): number {
    return this.bytes.length * 8 - this.bitPos;
  }

  /** `n` bits, most significant first, as an unsigned number (n ≤ 32). */
  u(n: number): number {
    if (n < 0 || n > 32) throw new RangeError(`cannot read ${n} bits`);
    if (n > this.bitsLeft) throw new RangeError('read past end of bitstream');
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.bytes[this.bitPos >> 3] ?? 0;
      const bit = (byte >> (7 - (this.bitPos & 7))) & 1;
      value = value * 2 + bit;
      this.bitPos++;
    }
    return value;
  }

  flag(): boolean {
    return this.u(1) === 1;
  }

  /** Unsigned Exp-Golomb `ue(v)`. */
  ue(): number {
    let leadingZeros = 0;
    while (this.u(1) === 0) {
      leadingZeros++;
      if (leadingZeros > 31) throw new RangeError('malformed Exp-Golomb code');
    }
    if (leadingZeros === 0) return 0;
    return 2 ** leadingZeros - 1 + this.u(leadingZeros);
  }

  /** Signed Exp-Golomb `se(v)`. */
  se(): number {
    const k = this.ue();
    return k % 2 === 1 ? (k + 1) / 2 : -(k / 2);
  }
}

/** Removes emulation-prevention bytes (`00 00 03` → `00 00`) from the first `maxBytes` of a NAL payload. */
export function unescapeRbsp(nal: Uint8Array, maxBytes: number = nal.length): Uint8Array {
  const limit = Math.min(nal.length, maxBytes);
  const out = new Uint8Array(limit);
  let n = 0;
  let zeros = 0;
  for (let i = 0; i < limit; i++) {
    const b = nal[i] ?? 0;
    if (zeros >= 2 && b === 3) {
      zeros = 0;
      continue;
    }
    out[n++] = b;
    zeros = b === 0 ? zeros + 1 : 0;
  }
  return out.subarray(0, n);
}

export interface SpsInfo {
  spsId: number;
  profileIdc: number;
  separateColourPlane: boolean;
  log2MaxFrameNum: number;
  pocType: number;
  /** Only meaningful when `pocType === 0`. */
  log2MaxPocLsb: number;
  frameMbsOnly: boolean;
}

const PROFILES_WITH_CHROMA_INFO = new Set([
  100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
]);

function skipScalingList(r: BitReader, size: number): void {
  let lastScale = 8;
  let nextScale = 8;
  for (let j = 0; j < size; j++) {
    if (nextScale !== 0) {
      const delta = r.se();
      nextScale = (lastScale + delta + 256) % 256;
    }
    lastScale = nextScale === 0 ? lastScale : nextScale;
  }
}

/** Parses a sequence parameter set RBSP (NAL header byte already stripped, emulation bytes removed). */
export function parseSps(rbsp: Uint8Array): SpsInfo {
  const r = new BitReader(rbsp);
  const profileIdc = r.u(8);
  r.u(8); // constraint flags + reserved
  r.u(8); // level_idc
  const spsId = r.ue();
  let separateColourPlane = false;
  if (PROFILES_WITH_CHROMA_INFO.has(profileIdc)) {
    const chromaFormatIdc = r.ue();
    if (chromaFormatIdc === 3) separateColourPlane = r.flag();
    r.ue(); // bit_depth_luma_minus8
    r.ue(); // bit_depth_chroma_minus8
    r.flag(); // qpprime_y_zero_transform_bypass_flag
    if (r.flag()) {
      const listCount = chromaFormatIdc !== 3 ? 8 : 12;
      for (let i = 0; i < listCount; i++) {
        if (r.flag()) skipScalingList(r, i < 6 ? 16 : 64);
      }
    }
  }
  const log2MaxFrameNum = r.ue() + 4;
  const pocType = r.ue();
  let log2MaxPocLsb = 0;
  if (pocType === 0) {
    log2MaxPocLsb = r.ue() + 4;
  } else if (pocType === 1) {
    r.flag(); // delta_pic_order_always_zero_flag
    r.se(); // offset_for_non_ref_pic
    r.se(); // offset_for_top_to_bottom_field
    const cycleLength = r.ue();
    for (let i = 0; i < cycleLength; i++) r.se();
  }
  r.ue(); // max_num_ref_frames
  r.flag(); // gaps_in_frame_num_value_allowed_flag
  r.ue(); // pic_width_in_mbs_minus1
  r.ue(); // pic_height_in_map_units_minus1
  const frameMbsOnly = r.flag();
  return { spsId, profileIdc, separateColourPlane, log2MaxFrameNum, pocType, log2MaxPocLsb, frameMbsOnly };
}

/** Parses the two ids at the start of a picture parameter set RBSP. */
export function parsePpsIds(rbsp: Uint8Array): { ppsId: number; spsId: number } {
  const r = new BitReader(rbsp);
  return { ppsId: r.ue(), spsId: r.ue() };
}

export interface AvcDecoderConfig {
  /** Bytes per NAL length prefix in the samples: 1, 2 or 4. */
  lengthSize: number;
  sps: Map<number, SpsInfo>;
  /** pps_id → sps_id */
  pps: Map<number, number>;
}

/** Parses the `avcC` payload (the `description` handed to `VideoDecoder.configure`). */
export function parseAvcC(avcC: Uint8Array): AvcDecoderConfig {
  if (avcC.length < 7) throw new Error('avcC too short');
  const view = new DataView(avcC.buffer, avcC.byteOffset, avcC.byteLength);
  const lengthSize = ((avcC[4] ?? 0) & 3) + 1;
  const sps = new Map<number, SpsInfo>();
  const pps = new Map<number, number>();
  let pos = 5;
  const spsCount = (avcC[pos++] ?? 0) & 31;
  for (let i = 0; i < spsCount; i++) {
    const len = view.getUint16(pos);
    pos += 2;
    const nal = avcC.subarray(pos, pos + len);
    pos += len;
    const info = parseSps(unescapeRbsp(nal.subarray(1)));
    sps.set(info.spsId, info);
  }
  const ppsCount = avcC[pos++] ?? 0;
  for (let i = 0; i < ppsCount; i++) {
    const len = view.getUint16(pos);
    pos += 2;
    const nal = avcC.subarray(pos, pos + len);
    pos += len;
    const ids = parsePpsIds(unescapeRbsp(nal.subarray(1), 16));
    pps.set(ids.ppsId, ids.spsId);
  }
  return { lengthSize, sps, pps };
}

export interface SliceInfo {
  nalUnitType: number;
  nalRefIdc: number;
  isIdr: boolean;
  frameNum: number;
  fieldPic: boolean;
  /** `null` unless the SPS uses POC type 0. */
  pocLsb: number | null;
  spsId: number;
}

const NAL_SLICE = 1;
const NAL_IDR_SLICE = 5;
/** Slice header fields up to `pic_order_cnt_lsb` fit in far fewer bytes than this. */
const SLICE_HEADER_SCAN_BYTES = 64;

/**
 * Finds the first coded slice of an access unit (a sample's bytes, length-prefixed
 * NAL units) and parses its header up to the picture order count.
 * Returns `null` when the sample contains no slice or the header is unreadable.
 */
export function parseFirstSliceHeader(sample: Uint8Array, cfg: AvcDecoderConfig): SliceInfo | null {
  const view = new DataView(sample.buffer, sample.byteOffset, sample.byteLength);
  let pos = 0;
  while (pos + cfg.lengthSize <= sample.length) {
    let nalLength = 0;
    for (let i = 0; i < cfg.lengthSize; i++) nalLength = nalLength * 256 + view.getUint8(pos + i);
    pos += cfg.lengthSize;
    if (nalLength <= 0 || pos + nalLength > sample.length) return null;
    const header = sample[pos] ?? 0;
    const nalUnitType = header & 31;
    const nalRefIdc = (header >> 5) & 3;
    if (nalUnitType === NAL_SLICE || nalUnitType === NAL_IDR_SLICE) {
      const rbsp = unescapeRbsp(sample.subarray(pos + 1, pos + nalLength), SLICE_HEADER_SCAN_BYTES);
      try {
        return parseSliceHeader(rbsp, nalUnitType, nalRefIdc, cfg);
      } catch {
        return null;
      }
    }
    pos += nalLength;
  }
  return null;
}

function parseSliceHeader(
  rbsp: Uint8Array,
  nalUnitType: number,
  nalRefIdc: number,
  cfg: AvcDecoderConfig,
): SliceInfo | null {
  const r = new BitReader(rbsp);
  r.ue(); // first_mb_in_slice
  r.ue(); // slice_type
  const ppsId = r.ue();
  const spsId = cfg.pps.get(ppsId);
  if (spsId === undefined) return null;
  const sps = cfg.sps.get(spsId);
  if (!sps) return null;
  if (sps.separateColourPlane) r.u(2); // colour_plane_id
  const frameNum = r.u(sps.log2MaxFrameNum);
  let fieldPic = false;
  if (!sps.frameMbsOnly) {
    fieldPic = r.flag();
    if (fieldPic) r.flag(); // bottom_field_flag
  }
  const isIdr = nalUnitType === NAL_IDR_SLICE;
  if (isIdr) r.ue(); // idr_pic_id
  const pocLsb = sps.pocType === 0 ? r.u(sps.log2MaxPocLsb) : null;
  return { nalUnitType, nalRefIdc, isIdr, frameNum, fieldPic, pocLsb, spsId };
}

export interface PictureOrder {
  /** Counts IDR pictures seen so far in decode order; POC restarts at every IDR. */
  gop: number;
  poc: number;
}

/**
 * Display order for frame pictures from their slice headers in decode order
 * (H.264 §8.2.1). Returns `null`, with a reason, when the stream uses a POC
 * scheme this module does not implement, so the caller falls back explicitly.
 */
export function derivePictureOrder(
  slices: readonly SliceInfo[],
  cfg: AvcDecoderConfig,
): { order: PictureOrder[] } | { order: null; reason: string } {
  const order: PictureOrder[] = [];
  let gop = 0;
  let prevMsb = 0;
  let prevLsb = 0;
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i]!;
    const sps = cfg.sps.get(s.spsId);
    if (!sps) return { order: null, reason: `slice ${i} references unknown SPS ${s.spsId}` };
    if (s.fieldPic) return { order: null, reason: 'field-coded pictures are not supported' };
    if (s.isIdr && i > 0) gop++;
    if (sps.pocType === 2) {
      // Output order equals decode order by definition (no B-frames).
      order.push({ gop, poc: i });
      continue;
    }
    if (sps.pocType !== 0 || s.pocLsb === null) {
      return { order: null, reason: `POC type ${sps.pocType} is not supported` };
    }
    if (s.isIdr) {
      prevMsb = 0;
      prevLsb = 0;
    }
    const maxLsb = 2 ** sps.log2MaxPocLsb;
    const lsb = s.pocLsb;
    let msb: number;
    if (lsb < prevLsb && prevLsb - lsb >= maxLsb / 2) msb = prevMsb + maxLsb;
    else if (lsb > prevLsb && lsb - prevLsb > maxLsb / 2) msb = prevMsb - maxLsb;
    else msb = prevMsb;
    order.push({ gop, poc: msb + lsb });
    if (s.nalRefIdc !== 0) {
      prevMsb = msb;
      prevLsb = lsb;
    }
  }
  return { order };
}
