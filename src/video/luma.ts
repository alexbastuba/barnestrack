/**
 * Copies the luma (Y) plane of a decoded `VideoFrame` into a tightly packed
 * `Uint8Array(width × height)`. The tracker works on this plane only; the
 * sample videos come from a grayscale camera, so chroma carries nothing.
 *
 * Handles the 8-bit planar/semi-planar YUV layouts WebCodecs can report
 * (plane 0 is always Y) including strides wider than the visible width, and
 * converts RGB outputs (rare, some hardware paths) with BT.601 weights.
 * 10/12-bit formats (two bytes per sample) are refused explicitly rather than
 * read as bytes; `parseMp4Index` already rejects those profiles at intake.
 */

export interface LumaScratch {
  /** Reused between frames so the pass does not allocate per frame. */
  buffer: ArrayBuffer;
}

export interface LumaPlane {
  width: number;
  height: number;
  gray: Uint8Array;
}

const YUV_FORMATS = new Set(['I420', 'I420A', 'I422', 'I444', 'NV12']);
const RGB_FORMATS = new Set(['RGBA', 'RGBX', 'BGRA', 'BGRX']);

export function createLumaScratch(): LumaScratch {
  return { buffer: new ArrayBuffer(0) };
}

/**
 * Copies the frame's visible luma into `target` (allocated to width × height
 * when not given). Does not close the frame.
 */
export async function copyLuma(
  frame: VideoFrame,
  scratch: LumaScratch,
  target?: Uint8Array,
): Promise<LumaPlane> {
  const format = frame.format;
  if (format === null) throw new Error('decoded frame has no pixel format (opaque frame)');
  const rect = frame.visibleRect ?? frame.codedRect;
  if (!rect) throw new Error('decoded frame has no visible rect');
  const width = rect.width;
  const height = rect.height;
  const gray = target ?? new Uint8Array(width * height);
  if (gray.length !== width * height) {
    throw new RangeError(`luma target has ${gray.length} bytes, expected ${width * height}`);
  }

  const needed = frame.allocationSize({ rect });
  if (scratch.buffer.byteLength < needed) scratch.buffer = new ArrayBuffer(needed);
  const bytes = new Uint8Array(scratch.buffer, 0, needed);
  const layout = await frame.copyTo(bytes, { rect });
  const plane0 = layout[0];
  if (!plane0) throw new Error('copyTo returned no plane layout');

  if (YUV_FORMATS.has(format)) {
    copyPlane(bytes, plane0.offset, plane0.stride, width, height, gray);
  } else if (RGB_FORMATS.has(format)) {
    rgbToLuma(bytes, plane0.offset, plane0.stride, width, height, gray, format.startsWith('BGR'));
  } else {
    throw new Error(
      `unsupported decoded pixel format ${format} (only 8-bit 4:2:0/4:2:2/4:4:4 and RGB frames are read)`,
    );
  }
  return { width, height, gray };
}

function copyPlane(
  src: Uint8Array,
  offset: number,
  stride: number,
  width: number,
  height: number,
  dst: Uint8Array,
): void {
  if (stride === width) {
    dst.set(src.subarray(offset, offset + width * height));
    return;
  }
  for (let y = 0; y < height; y++) {
    const rowStart = offset + y * stride;
    dst.set(src.subarray(rowStart, rowStart + width), y * width);
  }
}

function rgbToLuma(
  src: Uint8Array,
  offset: number,
  stride: number,
  width: number,
  height: number,
  dst: Uint8Array,
  blueFirst: boolean,
): void {
  const rIdx = blueFirst ? 2 : 0;
  const bIdx = blueFirst ? 0 : 2;
  for (let y = 0; y < height; y++) {
    let p = offset + y * stride;
    const row = y * width;
    for (let x = 0; x < width; x++, p += 4) {
      const r = src[p + rIdx]!;
      const g = src[p + 1]!;
      const b = src[p + bIdx]!;
      // BT.601 limited-range luma, rounded
      dst[row + x] = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16) & 0xff;
    }
  }
}
