/**
 * 32-bit FNV-1a over a gray plane. Used by the frame-server prototype to
 * check that random access returns byte-identical luma to the sequential
 * pass; nothing in the product depends on it.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

export function fnv1a32(bytes: Uint8Array): number {
  let hash = FNV_OFFSET;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

export function hashHex(hash: number): string {
  return hash.toString(16).padStart(8, '0');
}
