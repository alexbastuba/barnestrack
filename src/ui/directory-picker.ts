/**
 * "Choose a folder" without a server. The File System Access API is not in
 * TypeScript's DOM library, so the two members used here are declared locally
 * and feature-detected; browsers without it fall back to `webkitdirectory`,
 * which every supported browser has.
 */

interface DirectoryEntryHandle {
  kind: 'file' | 'directory';
  name: string;
  getFile?(): Promise<File>;
  entries?(): AsyncIterableIterator<[string, DirectoryEntryHandle]>;
}

interface WindowWithDirectoryPicker {
  showDirectoryPicker?(options?: { mode?: 'read' | 'readwrite' }): Promise<DirectoryEntryHandle>;
}

const MAX_DEPTH = 4;

export function hasDirectoryPicker(): boolean {
  return typeof (window as WindowWithDirectoryPicker).showDirectoryPicker === 'function';
}

/**
 * Opens the picker and returns every file in the folder tree, depth-limited.
 * Resolves with an empty list when the user cancels.
 */
export async function pickDirectoryFiles(): Promise<File[]> {
  const picker = (window as WindowWithDirectoryPicker).showDirectoryPicker;
  if (!picker) return [];
  let handle: DirectoryEntryHandle;
  try {
    handle = await picker.call(window, { mode: 'read' });
  } catch {
    return [];
  }
  const files: File[] = [];
  await collect(handle, 0, files);
  files.sort((a, b) => a.name.localeCompare(b.name));
  return files;
}

async function collect(handle: DirectoryEntryHandle, depth: number, out: File[]): Promise<void> {
  if (depth > MAX_DEPTH || !handle.entries) return;
  for await (const [, entry] of handle.entries()) {
    if (entry.kind === 'file' && entry.getFile) out.push(await entry.getFile());
    else if (entry.kind === 'directory') await collect(entry, depth + 1, out);
  }
}
