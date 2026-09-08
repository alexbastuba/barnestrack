// @vitest-environment happy-dom
/**
 * The network-consent dialog (D2, D33).
 *
 * "Load example cohort" is the one control in the product that reaches the
 * network, so it asks first, in a dialog that names every file and its size.
 * Confirm loads the bundle and then fetches all three clips one after another;
 * Cancel does nothing at all. Offline, the bundle still loads and each clip
 * fails with its own message, which is the case asserted last.
 *
 * Nothing here touches the network: every fetch is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import type { SessionFile, VideoDescriptor } from '../../src/contracts/session.js';
import { EXAMPLE_SESSION_NAME } from '../../src/demo/example-cohort.js';
import { LOAD_BUTTON_LABEL, mountExampleCohortPanel } from '../../src/demo/example-cohort-ui.js';
import { SAMPLE_CLIPS, SAMPLE_CLIPS_TOTAL_BYTES } from '../../src/demo/fetch-sample-clip.js';
import { createSessionFile } from '../../src/session/session-file.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';

const TOOL_VERSION = 'barnestrack v0.0.0 (test)';

function descriptor(filename: string, byteLength: number): VideoDescriptor {
  return {
    id: `video-${filename}`,
    filename,
    fingerprint: { byteLength, durationSeconds: 30.2, frameCount: 905, sha256: 'a'.repeat(64) },
    referenceResolution: { width: 640, height: 480 },
    mazeTransform: { translateX: 0, translateY: 0, rotationDeg: 0, scale: 1 },
    metadata: {},
  };
}

function exampleSessionFile(): SessionFile {
  return {
    ...createSessionFile(EXAMPLE_SESSION_NAME, TOOL_VERSION),
    videos: SAMPLE_CLIPS.map((clip) => descriptor(clip.filename, clip.byteLength)),
  };
}

interface Harness {
  panel: HTMLElement;
  store: SessionStore;
  said: string[];
  clipRequests: string[];
}

/**
 * Serves the bundle from memory and refuses every clip, which is both the
 * offline case and the one that keeps the assertions about *which* URLs were
 * asked for independent of any decoding.
 */
function mount(options: { clipsFail?: boolean } = {}): Harness {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  const said: string[] = [];
  const clipRequests: string[] = [];
  const bundle = JSON.stringify(exampleSessionFile());

  const fetchImpl = (input: string): Promise<Response> => {
    if (input.endsWith('.mp4')) {
      clipRequests.push(input);
      if (options.clipsFail !== false) return Promise.reject(new TypeError('Failed to fetch'));
      return Promise.resolve(new Response(new Uint8Array([0, 0, 0, 0]), { status: 200 }));
    }
    return Promise.resolve(
      new Response(new Blob([bundle]).stream().pipeThrough(new CompressionStream('gzip')), {
        status: 200,
        headers: { 'content-type': 'application/gzip' },
      }),
    );
  };

  const panel = mountExampleCohortPanel({
    store,
    announce: (message) => said.push(message),
    loaderOptions: { fetchImpl },
  });
  document.body.replaceChildren(panel);
  return { panel, store, said, clipRequests };
}

const loadButton = (panel: HTMLElement): HTMLButtonElement =>
  [...panel.querySelectorAll('button')].find((b) => b.textContent === LOAD_BUTTON_LABEL)!;
const dialog = (panel: HTMLElement): HTMLDialogElement =>
  panel.querySelector<HTMLDialogElement>('.example-dialog')!;
const confirmButton = (panel: HTMLElement): HTMLButtonElement =>
  panel.querySelector<HTMLButtonElement>('.example-dialog .primary')!;
const cancelButton = (panel: HTMLElement): HTMLButtonElement =>
  [...panel.querySelectorAll<HTMLButtonElement>('.example-dialog button')].find(
    (b) => b.textContent === 'Cancel',
  )!;

describe('the network-consent dialog', () => {
  it('starts closed and opens on the load button', () => {
    const { panel } = mount();
    expect(dialog(panel).open).toBe(false);
    loadButton(panel).click();
    expect(dialog(panel).open).toBe(true);
  });

  it('names the D2 sentence, all three files and their sizes', () => {
    const { panel } = mount();
    const text = dialog(panel).textContent ?? '';
    expect(text).toContain('This is the only time BarnesTrack contacts the network');
    for (const clip of SAMPLE_CLIPS) expect(text).toContain(clip.filename);
    const items = [...dialog(panel).querySelectorAll('.example-file-list li')].map(
      (li) => li.textContent,
    );
    expect(items).toEqual([
      'test50.mp4 — 2.2 MB',
      'test51.mp4 — 445 KB',
      'test53.mp4 — 485 KB',
    ]);
    expect(SAMPLE_CLIPS_TOTAL_BYTES).toBe(2_333_495 + 455_830 + 496_723);
    expect(text).toContain('3.1 MB in total');
  });

  it('is a labelled dialog whose confirm button takes focus', () => {
    const { panel } = mount();
    expect(dialog(panel).getAttribute('aria-labelledby')).toBeTruthy();
    const titleId = dialog(panel).getAttribute('aria-labelledby')!;
    expect(dialog(panel).querySelector(`#${titleId}`)!.textContent).toBe(
      'Load the example cohort?',
    );
    loadButton(panel).click();
    expect(document.activeElement).toBe(confirmButton(panel));
  });

  it('does nothing at all on Cancel', async () => {
    const { panel, store, said, clipRequests } = mount();
    loadButton(panel).click();
    cancelButton(panel).click();

    expect(dialog(panel).open).toBe(false);
    expect(store.videos).toHaveLength(0);
    expect(clipRequests).toEqual([]);
    expect(said).toEqual([]);
  });

  it('loads the bundle and asks for all three clips on Confirm', async () => {
    const { panel, store, clipRequests } = mount();
    loadButton(panel).click();
    confirmButton(panel).click();

    await vi.waitFor(() => expect(clipRequests).toHaveLength(3));
    expect(store.videos).toHaveLength(3);
    expect(clipRequests).toEqual(SAMPLE_CLIPS.map((clip) => clip.url));
    // One after another, and every one from the sample-data repository.
    for (const url of clipRequests) {
      expect(url.startsWith('https://raw.githubusercontent.com/')).toBe(true);
    }
  });

  it('offline: the results still load and each clip fails with its own message', async () => {
    const { panel, store, said } = mount({ clipsFail: true });
    loadButton(panel).click();
    confirmButton(panel).click();

    await vi.waitFor(() => expect(said.some((m) => m.includes('0 of 3 clips'))).toBe(true));
    // The bundle is in: the numbers render with no file attached (D33).
    expect(store.videos).toHaveLength(3);
    expect(store.current.name).toBe(EXAMPLE_SESSION_NAME);
    expect(store.videos.every((video) => !store.isAttached(video.id))).toBe(true);
    const outcome = said[said.length - 1]!;
    expect(outcome).toContain('Could not reach the sample-data repository');
  });
});
