/**
 * Random-access byte reads over a video file, in the browser (`File`/`Blob`)
 * and in Node (`ArrayBuffer`). Everything in `src/video/` reads sample bytes
 * through this interface so the demuxer, decoder and frame source share one
 * code path and never hold a whole file in memory by accident.
 */

export interface ByteSource {
  readonly byteLength: number;
  /** Bytes `[start, end)` as a fresh ArrayBuffer. `end` is clamped to `byteLength`. */
  read(start: number, end: number): Promise<ArrayBuffer>;
}

export type ByteSourceInput = Blob | ArrayBuffer | ByteSource;

function clampRange(byteLength: number, start: number, end: number): [number, number] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    throw new RangeError(`invalid byte range [${start}, ${end})`);
  }
  return [Math.min(start, byteLength), Math.min(end, byteLength)];
}

export function byteSourceFromBlob(blob: Blob): ByteSource {
  return {
    byteLength: blob.size,
    async read(start, end) {
      const [s, e] = clampRange(blob.size, start, end);
      return blob.slice(s, e).arrayBuffer();
    },
  };
}

export function byteSourceFromArrayBuffer(buffer: ArrayBuffer): ByteSource {
  return {
    byteLength: buffer.byteLength,
    read(start, end) {
      const [s, e] = clampRange(buffer.byteLength, start, end);
      return Promise.resolve(buffer.slice(s, e));
    },
  };
}

function isByteSource(value: unknown): value is ByteSource {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ByteSource).read === 'function' &&
    typeof (value as ByteSource).byteLength === 'number'
  );
}

export function toByteSource(input: ByteSourceInput): ByteSource {
  if (isByteSource(input)) return input;
  if (input instanceof ArrayBuffer) return byteSourceFromArrayBuffer(input);
  if (typeof Blob !== 'undefined' && input instanceof Blob) return byteSourceFromBlob(input);
  throw new TypeError('expected a Blob, an ArrayBuffer or a ByteSource');
}
