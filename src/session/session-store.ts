/**
 * The session in memory: one `SessionFile` as the single source of truth,
 * with a small event emitter and a debounced autosave. D9, D27, D28, D47.
 *
 * Two things live beside the session file rather than inside it. *Attachments*
 * (the `File` and the decoders opened over it) are per-tab and never
 * serialised — after a reload a video is present but "not attached" until the
 * same file is dropped again, matched by fingerprint. *Maze clicks* are the
 * on-screen click budget (D29); they are not in the contract, so they are
 * remembered in the autosave record and not written into a downloaded file.
 *
 * Nothing here mutates an `auto` layer: this store only ever replaces whole
 * descriptors, the maze map, and metadata.
 */
import type { MazeMapFile, SimilarityTransform } from '../contracts/mazeMap.js';
import type {
  SessionFile,
  VideoDescriptor,
  VideoFingerprint,
  VideoMetadata,
} from '../contracts/session.js';
import type { FrameSource } from '../video/frame-source.js';
import type { Mp4Index } from '../video/mp4-index.js';
import { findByFingerprint } from './attach.js';
import { createSessionFile } from './session-file.js';
import type { SessionStorage } from './storage.js';
import type { StoredSession, VideoId } from './stored.js';

/** The open file behind a video in this tab. Never serialised. */
export interface VideoAttachment {
  file: File;
  index: Mp4Index;
  frameSource: FrameSource;
}

export interface NewVideo {
  filename: string;
  fingerprint: VideoFingerprint;
  referenceResolution: { width: number; height: number };
}

/** What the autosave is doing, so the page can say whether work is safe. D27. */
export type SaveState = 'saved' | 'pending' | 'failed';

export const DEFAULT_SESSION_NAME = 'Untitled session';
const DEFAULT_AUTOSAVE_DELAY_MS = 500;
const IDENTITY_TRANSFORM: SimilarityTransform = {
  translateX: 0,
  translateY: 0,
  rotationDeg: 0,
  scale: 1,
};

export interface SessionStoreOptions {
  autosaveDelayMs?: number;
  /** Called when an autosave fails, so the UI can say so instead of losing work silently. */
  onSaveError?: (error: Error) => void;
}

export class SessionStore {
  private session: SessionFile;
  private mazeClicks: Record<VideoId, number> = {};
  private readonly attachments = new Map<VideoId, VideoAttachment>();
  private readonly listeners = new Set<() => void>();
  private readonly autosaveDelayMs: number;
  private readonly onSaveError: (error: Error) => void;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveChain: Promise<void> = Promise.resolve();
  private saveState: SaveState = 'saved';

  constructor(
    private readonly storage: SessionStorage,
    private readonly toolVersion: string,
    options: SessionStoreOptions = {},
  ) {
    this.autosaveDelayMs = options.autosaveDelayMs ?? DEFAULT_AUTOSAVE_DELAY_MS;
    this.onSaveError = options.onSaveError ?? (() => {});
    this.session = createSessionFile(DEFAULT_SESSION_NAME, toolVersion);
  }

  /** The session file as it stands. Treat as read-only; mutate through the methods. */
  get current(): SessionFile {
    return this.session;
  }

  get videos(): readonly VideoDescriptor[] {
    return this.session.videos;
  }

  /** Whether everything in memory has reached storage. */
  get autosaveState(): SaveState {
    return this.saveState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- restore / replace / reset -------------------------------------------

  /** Loads the autosave record, if there is one. Returns whether anything was restored. */
  async restore(): Promise<boolean> {
    const record = await this.storage.load();
    if (!record) return false;
    this.closeAttachments();
    this.session = record.file;
    this.mazeClicks = { ...record.mazeClicks };
    this.emit();
    return true;
  }

  /** Replaces everything with a loaded session file. Click counts are not in the file (D47 note). */
  replaceSession(session: SessionFile): void {
    this.closeAttachments();
    this.session = session;
    this.mazeClicks = {};
    this.changed();
  }

  /** Clears memory and the autosave record. */
  async reset(): Promise<void> {
    this.closeAttachments();
    this.session = createSessionFile(DEFAULT_SESSION_NAME, this.toolVersion);
    this.mazeClicks = {};
    this.cancelPendingSave();
    await this.storage.clear();
    this.saveState = 'saved';
    this.emit();
  }

  // ---- videos ---------------------------------------------------------------

  /** Adds a video, or returns the existing descriptor when the content is already loaded. */
  addVideo(video: NewVideo): { descriptor: VideoDescriptor; duplicateOf?: VideoDescriptor } {
    const existing = findByFingerprint(this.session.videos, video.fingerprint);
    if (existing) return { descriptor: existing, duplicateOf: existing };

    const descriptor: VideoDescriptor = {
      id: this.nextVideoId(),
      filename: video.filename,
      fingerprint: video.fingerprint,
      referenceResolution: video.referenceResolution,
      mazeTransform: { ...IDENTITY_TRANSFORM },
      metadata: {},
    };
    this.session.videos = [...this.session.videos, descriptor];
    if (this.session.name === DEFAULT_SESSION_NAME) {
      this.session.name = video.filename.replace(/\.[^.]+$/, '');
    }
    this.changed();
    return { descriptor };
  }

  removeVideo(videoId: VideoId): void {
    this.attachments.get(videoId)?.frameSource.close();
    this.attachments.delete(videoId);
    this.session.videos = this.session.videos.filter((v) => v.id !== videoId);
    delete this.session.analyses[videoId];
    delete this.mazeClicks[videoId];
    this.changed();
  }

  videoById(videoId: VideoId): VideoDescriptor | undefined {
    return this.session.videos.find((v) => v.id === videoId);
  }

  /** The descriptor whose content matches this fingerprint, for re-attaching after a reload. */
  matchFingerprint(fingerprint: VideoFingerprint): VideoDescriptor | undefined {
    return findByFingerprint(this.session.videos, fingerprint);
  }

  setMetadata(videoId: VideoId, metadata: VideoMetadata): void {
    this.updateVideo(videoId, (video) => ({ ...video, metadata: { ...metadata } }));
  }

  setName(name: string): void {
    this.session.name = name;
    this.changed();
  }

  // ---- attachments (this tab only) -----------------------------------------

  attach(videoId: VideoId, attachment: VideoAttachment): void {
    this.attachments.get(videoId)?.frameSource.close();
    this.attachments.set(videoId, attachment);
    this.emit();
  }

  attachmentFor(videoId: VideoId): VideoAttachment | undefined {
    return this.attachments.get(videoId);
  }

  isAttached(videoId: VideoId): boolean {
    return this.attachments.has(videoId);
  }

  // ---- maze -----------------------------------------------------------------

  setMazeMap(map: MazeMapFile | null): void {
    this.session.mazeMap = map;
    this.changed();
  }

  setMazeTransform(videoId: VideoId, transform: SimilarityTransform): void {
    this.updateVideo(videoId, (video) => ({ ...video, mazeTransform: { ...transform } }));
  }

  countMazeClick(videoId: VideoId, clicks = 1): void {
    this.mazeClicks[videoId] = (this.mazeClicks[videoId] ?? 0) + clicks;
    this.changed();
  }

  clearMazeClicks(videoId: VideoId): void {
    delete this.mazeClicks[videoId];
    this.changed();
  }

  mazeClickCount(videoId: VideoId): number {
    return this.mazeClicks[videoId] ?? 0;
  }

  // ---- persistence ----------------------------------------------------------

  toStoredSession(): StoredSession {
    return {
      file: this.session,
      mazeClicks: { ...this.mazeClicks },
      savedAt: new Date().toISOString(),
    };
  }

  /** Waits for any debounced autosave to finish. */
  async flush(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.queueSave();
    }
    await this.saveChain;
  }

  // ---- internals ------------------------------------------------------------

  private updateVideo(videoId: VideoId, change: (video: VideoDescriptor) => VideoDescriptor): void {
    let touched = false;
    this.session.videos = this.session.videos.map((video) => {
      if (video.id !== videoId) return video;
      touched = true;
      return change(video);
    });
    if (touched) this.changed();
  }

  private nextVideoId(): VideoId {
    let n = this.session.videos.length + 1;
    const taken = new Set(this.session.videos.map((v) => v.id));
    let id = `vid_${String(n).padStart(2, '0')}`;
    while (taken.has(id)) {
      n++;
      id = `vid_${String(n).padStart(2, '0')}`;
    }
    return id;
  }

  private closeAttachments(): void {
    for (const attachment of this.attachments.values()) attachment.frameSource.close();
    this.attachments.clear();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private changed(): void {
    // Schedule first: `scheduleSave` moves the save state to 'pending', and the
    // page must render that, not the stale 'saved' from before the edit.
    this.scheduleSave();
    this.emit();
  }

  private cancelPendingSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private scheduleSave(): void {
    this.cancelPendingSave();
    this.saveState = 'pending';
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.queueSave();
    }, this.autosaveDelayMs);
  }

  /** Serialises saves so a fast edit never overtakes a slower earlier write. */
  private queueSave(): void {
    const record = this.toStoredSession();
    this.saveChain = this.saveChain
      .then(async () => {
        await this.storage.save(record);
        if (this.saveTimer === null) this.saveState = 'saved';
        this.emit();
      })
      .catch((error: unknown) => {
        this.saveState = 'failed';
        this.emit();
        this.onSaveError(error instanceof Error ? error : new Error(String(error)));
      });
  }
}
