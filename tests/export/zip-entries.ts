/**
 * Test helper: the entries of a store-only ZIP (`src/export/zip.ts`), by name.
 * Shared by the Vitest bundle tests and the Playwright specs that open a real
 * downloaded bundle, so both read the archive the same way.
 */
export async function entriesOf(zip: Blob): Promise<Map<string, Uint8Array>> {
  const archive = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(archive.buffer);
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    out.set(
      decoder.decode(archive.subarray(offset + 30, offset + 30 + nameLength)),
      archive.subarray(dataStart, dataStart + size),
    );
    offset = dataStart + size;
  }
  return out;
}
