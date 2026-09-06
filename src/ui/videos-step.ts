/**
 * Step 1 — Videos. Intake by drag-and-drop, file picker or folder picker,
 * filtered to MP4/H.264; everything else is listed with the reason and a
 * re-encode hint, never silently dropped (D28, O13).
 *
 * Files are read in this tab and nowhere else: parsing the sample table and
 * hashing the bytes both happen locally, and the card says so (D2).
 */
import type { VideoDescriptor, VideoMetadata } from '../contracts/session.js';
import { inspectFile, REENCODE_HINT } from '../session/intake.js';
import type { VideoId } from '../session/stored.js';
import { byteSourceFromBlob } from '../video/byte-source.js';
import { FrameSource } from '../video/frame-source.js';
import type { Mp4Index } from '../video/mp4-index.js';
import { hasDirectoryPicker, pickDirectoryFiles } from './directory-picker.js';
import { button, el, formatBytes, formatDuration, replaceChildren, type Child } from './dom.js';
import type { AppContext, Step } from './step.js';

const PRIVACY_NOTE = 'Processed locally — this file never leaves your computer.';
const REATTACH_HINT = 'your maze, tracks and corrections are intact';

interface Rejection {
  filename: string;
  reason: string;
  hint: string | null;
}

const METADATA_FIELDS: { key: keyof VideoMetadata; label: string }[] = [
  { key: 'animal', label: 'Animal' },
  { key: 'day', label: 'Day' },
  { key: 'trial', label: 'Trial' },
  { key: 'group', label: 'Group' },
];

export function createVideosStep(context: AppContext): Step {
  const { store } = context;
  const rejections: Rejection[] = [];
  const notes: string[] = [];
  const queue: File[] = [];
  let busy = false;

  const body = el('div', { class: 'videos-step drop-zone' });

  // ---- pickers --------------------------------------------------------------

  const fileInput = el('input', { id: 'choose-videos' });
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = '.mp4,video/mp4';
  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    void ingest(files);
  });

  const folderInput = el('input', { id: 'choose-folder' });
  folderInput.type = 'file';
  folderInput.multiple = true;
  folderInput.setAttribute('webkitdirectory', '');
  folderInput.addEventListener('change', () => {
    const files = [...(folderInput.files ?? [])];
    folderInput.value = '';
    void ingest(files);
  });

  const folderButton = button('Choose a folder', () => {
    void pickDirectoryFiles().then((files) => ingest(files));
  });

  const pickers = el('div', { class: 'pickers' }, [
    el('div', { class: 'field' }, [
      el('label', { text: 'Choose videos', attrs: { for: 'choose-videos' } }),
      fileInput,
    ]),
    hasDirectoryPicker()
      ? el('div', { class: 'field' }, [
          el('span', { class: 'label-like', text: 'Choose a folder' }),
          folderButton,
        ])
      : el('div', { class: 'field' }, [
          el('label', { text: 'Choose a folder', attrs: { for: 'choose-folder' } }),
          folderInput,
        ]),
    el('p', {
      class: 'hint drop-hint',
      text: 'Or drop MP4 files anywhere in this panel. Only MP4 with H.264 (AVC) video is read.',
    }),
  ]);

  // ---- lists ----------------------------------------------------------------

  const list = el('ul', { class: 'video-list', attrs: { 'aria-label': 'Loaded videos' } });
  const listEmpty = el('p', { class: 'hint', text: 'No videos loaded yet.' });
  const notesBox = el('ul', { class: 'notes', attrs: { 'aria-label': 'Intake notes' } });
  const notLoaded = el('section', { class: 'not-loaded' }, [
    el('h3', { text: 'Not loaded' }),
    el('ul', { class: 'rejection-list' }),
  ]);
  notLoaded.hidden = true;
  const rejectionList = notLoaded.querySelector('ul') as HTMLUListElement;

  body.append(pickers, listEmpty, list, notesBox, notLoaded);

  // ---- drag and drop --------------------------------------------------------

  let dragDepth = 0;
  body.addEventListener('dragenter', (event) => {
    event.preventDefault();
    dragDepth += 1;
    body.classList.add('is-dragging');
  });
  body.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  body.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) body.classList.remove('is-dragging');
  });
  body.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    body.classList.remove('is-dragging');
    void ingest([...(event.dataTransfer?.files ?? [])]);
  });

  // ---- intake ---------------------------------------------------------------

  /**
   * Files dropped while an earlier batch is still being hashed join the queue
   * rather than being discarded: reading an 80 MB video takes seconds, and a
   * second drop in that window used to vanish without a word (D28 — nothing is
   * ever silently dropped).
   */
  async function ingest(files: File[]): Promise<void> {
    if (files.length === 0) return;
    queue.push(...files);
    if (busy) {
      context.announce(
        `Still reading the previous file; ${queue.length} more queued, starting with ${files[0]?.name ?? ''}.`,
      );
      return;
    }
    busy = true;
    notes.length = 0;
    try {
      let done = 0;
      while (queue.length > 0) {
        const file = queue.shift()!;
        done += 1;
        const remaining = queue.length;
        context.announce(
          remaining === 0
            ? `Reading ${file.name}${done === 1 ? '' : ', the last one'}…`
            : `Reading ${file.name}, ${remaining} more to go…`,
        );
        // One file at a time: memory stays flat and the status line stays truthful.
        await acceptOne(file);
        render();
      }
    } finally {
      busy = false;
      render();
    }
  }

  async function acceptOne(file: File): Promise<void> {
    const result = await inspectFile(file);
    if (result.kind === 'rejected') {
      dropRejection(result.file.name, result.reason, result.hint);
      context.announce(`${file.name} was not loaded: ${result.reason}`);
      return;
    }
    const { index, fingerprint } = result;
    const existing = store.matchFingerprint(fingerprint);
    if (existing && store.isAttached(existing.id)) {
      notes.push(
        existing.filename === file.name
          ? `${file.name} is already loaded.`
          : `${file.name} is the same video as ${existing.filename}, which is already loaded.`,
      );
      context.announce(notes[notes.length - 1] ?? '');
      return;
    }
    if (existing) {
      attach(existing.id, file, index);
      context.announce(
        `${file.name} re-attached to ${existing.filename}: ${index.frameCount} frames. ${capitalise(REATTACH_HINT)}.`,
      );
      return;
    }
    const { descriptor } = store.addVideo({
      filename: file.name,
      fingerprint,
      referenceResolution: { width: index.width, height: index.height },
    });
    attach(descriptor.id, file, index);
    context.announce(`${file.name} loaded: ${index.frameCount} frames.`);
  }

  function attach(videoId: VideoId, file: File, index: Mp4Index): void {
    store.attach(videoId, {
      file,
      index,
      frameSource: new FrameSource(index, byteSourceFromBlob(file)),
    });
  }

  function dropRejection(filename: string, reason: string, hint: string | null): void {
    const already = rejections.findIndex((r) => r.filename === filename);
    if (already >= 0) rejections.splice(already, 1);
    rejections.push({ filename, reason, hint });
  }

  // ---- rendering ------------------------------------------------------------

  const cards = new Map<VideoId, { root: HTMLLIElement; update(): void }>();
  let lastEpoch = store.epoch;

  function render(): void {
    if (store.epoch !== lastEpoch) {
      // Reset, load or restore replaced the session; "Not loaded" and the
      // duplicate notes described the one before it.
      lastEpoch = store.epoch;
      rejections.length = 0;
      notes.length = 0;
    }
    const ids = store.videos.map((v) => v.id);
    if (ids.length !== cards.size || ids.some((id) => !cards.has(id))) {
      cards.clear();
      list.replaceChildren();
      for (const descriptor of store.videos) {
        const card = createCard(descriptor);
        cards.set(descriptor.id, card);
        list.append(card.root);
      }
    }
    for (const card of cards.values()) card.update();

    listEmpty.hidden = store.videos.length > 0;
    list.hidden = store.videos.length === 0;

    replaceChildren(
      notesBox,
      notes.map((text) => el('li', { text })),
    );
    notesBox.hidden = notes.length === 0;

    replaceChildren(
      rejectionList,
      rejections.map((rejection) =>
        el('li', { class: 'rejection' }, [
          el('strong', { text: rejection.filename }),
          el('p', { text: rejection.reason }),
          rejection.hint === null
            ? null
            : el('p', { class: 'hint' }, [
                'Re-encode it with ',
                el('code', { text: rejection.hint }),
                ' and load the result.',
              ]),
        ]),
      ),
    );
    notLoaded.hidden = rejections.length === 0;
  }

  function createCard(descriptor: VideoDescriptor): { root: HTMLLIElement; update(): void } {
    const videoId = descriptor.id;
    const title = el('h3', { text: descriptor.filename });
    const state = el('span', { class: 'badge' });
    const facts = el('dl', { class: 'video-facts' });
    const detachedNote = el('p', { class: 'detached-note' });
    const inputs = new Map<keyof VideoMetadata, HTMLInputElement>();

    const metadata = el('div', { class: 'metadata' }, [
      el('span', { class: 'label-like', text: 'Cohort metadata' }),
      ...METADATA_FIELDS.map(({ key, label }) => {
        const input = el('input', { id: `meta-${videoId}-${key}`, class: 'meta-input' });
        input.type = 'text';
        input.autocomplete = 'off';
        input.addEventListener('change', () => {
          const next: VideoMetadata = {};
          for (const [name, control] of inputs) {
            const value = control.value.trim();
            if (value) next[name] = value;
          }
          store.setMetadata(videoId, next);
          context.announce(`${descriptor.filename}: ${label.toLowerCase()} set to ${input.value.trim() || 'blank'}.`);
        });
        inputs.set(key, input);
        return el('div', { class: 'field' }, [
          el('label', { text: label, attrs: { for: input.id } }),
          input,
        ]);
      }),
    ]);

    const remove = button(
      'Remove',
      () => {
        const current = store.videoById(videoId);
        store.removeVideo(videoId);
        context.announce(`${current?.filename ?? 'Video'} removed from the session.`);
        render();
        context.showStep('videos');
      },
      { class: 'remove' },
    );

    const root = el('li', { class: 'video-card' }, [
      el('div', { class: 'video-card-head' }, [title, state, remove]),
      facts,
      el('p', { class: 'privacy-note', text: PRIVACY_NOTE }),
      detachedNote,
      metadata,
    ]);

    function update(): void {
      const video = store.videoById(videoId);
      if (!video) return;
      title.textContent = video.filename;
      const attachment = store.attachmentFor(videoId);
      const attached = attachment !== undefined;
      state.textContent = attached ? 'file attached' : 'video not attached';
      state.className = `badge ${attached ? 'badge-ok' : 'badge-warn'}`;
      root.classList.toggle('is-detached', !attached);

      replaceChildren(facts, factRows(video, attachment?.index));

      detachedNote.hidden = attached;
      detachedNote.textContent = attached
        ? ''
        : `Drop ${video.filename} again to re-attach — ${REATTACH_HINT}. Re-attaching matches the file's contents, so a renamed copy works and a different file with the same name does not.`;

      for (const [key, input] of inputs) {
        if (document.activeElement === input) continue;
        input.value = video.metadata[key] ?? '';
      }
    }

    return { root, update };
  }

  function factRows(video: VideoDescriptor, index: Mp4Index | undefined): Child[] {
    const rows: [string, Child[]][] = [
      ['Frames', [String(index?.frameCount ?? video.fingerprint.frameCount)]],
      [
        'Frame rate',
        index
          ? [`${index.nominalFps.toFixed(3)} fps `, el('span', { class: 'hint', text: "from the file's own timebase" })]
          : [el('span', { class: 'hint', text: 'read from the file when it is re-attached' })],
      ],
      ['Duration', [formatDuration(index?.durationSeconds ?? video.fingerprint.durationSeconds)]],
      ['Resolution', [`${video.referenceResolution.width} × ${video.referenceResolution.height}`]],
      ['Codec', index ? [index.codec] : [el('span', { class: 'hint', text: 'H.264 (AVC)' })]],
      ['File size', [formatBytes(video.fingerprint.byteLength)]],
    ];
    if (index && index.warnings.length > 0) {
      rows.push(['Notes', [index.warnings.join('; ')]]);
    }
    return rows.map(([term, definition]) =>
      el('div', { class: 'fact' }, [el('dt', { text: term }), el('dd', {}, definition)]),
    );
  }

  function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  return {
    id: 'videos',
    label: 'Videos',
    what:
      'Load the videos of one cohort. Each file is read in this browser: BarnesTrack parses its ' +
      'frame table and fingerprints its contents so the session can find the same file again after ' +
      'a reload. Nothing is uploaded.',
    definitions: () => [
      el('dl', { class: 'definition-list' }, [
        el('dt', { text: 'Frames' }),
        el('dd', {
          text:
            'The number of pictures in the file’s own sample table, in presentation order. ' +
            'This is what "frame N" means everywhere in BarnesTrack (D7).',
        }),
        el('dt', { text: 'Frame rate' }),
        el('dd', {
          text:
            'Read from the file’s own timebase and shown for orientation only. Every ' +
            'measurement uses each frame’s recorded timestamp, never frame ÷ frame rate, ' +
            'because these clips drop and duplicate frames (D7, O11).',
        }),
        el('dt', { text: 'Accepted files' }),
        el('dd', {
          text: `MP4 containing 8-bit 4:2:0 H.264 (AVC) video (O13). Anything else is listed under "Not loaded" with the reason and this re-encode command: ${REENCODE_HINT}`,
        }),
        el('dt', { text: 'Cohort metadata' }),
        el('dd', {
          text:
            'Animal, day, trial and group are typed in, never guessed from the filename, and they ' +
            'become columns in every export (O12).',
        }),
        el('dt', { text: 'Re-attaching' }),
        el('dd', {
          text:
            'Videos are matched by content (file size, then a SHA-256 of the bytes), never by name, ' +
            'so a renamed copy re-attaches and a different file with a familiar name does not (D27).',
        }),
      ]),
    ],
    body,
    blocked: () => null,
    refresh: render,
  };
}
