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
 * descriptors, the maze map, metadata, a corrections layer and the derived
 * cache.
 */
import { DEFAULT_PARAMETERS, assertValidParameters } from '../analysis/parameters.js';
import type { MazeMapFile, SimilarityTransform } from '../contracts/mazeMap.js';
import type { Parameters, TrackingParameters } from '../contracts/parameters.js';
import type {
  AutoLayer,
  CorrectionsLayer,
  DerivedLayer,
  SessionFile,
  VideoAnalysis,
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
  private draftMazeMap: MazeMapFile | null = null;
  /** The parameters in force before the first analysis stamps them (D51). */
  private workingParameters: Parameters | null = null;
  private mazeClicks: Record<VideoId, number> = {};
  /** Bumped whenever the whole session is replaced, so views can drop cached state. */
  private sessionEpoch = 0;
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

  /** Changes whenever the whole session is replaced (load, reset, restore). */
  get epoch(): number {
    return this.sessionEpoch;
  }

  /**
   * The maze map being worked on: the session file's once it is calibrated,
   * the unpublished draft before that (D14, D47).
   */
  get workingMazeMap(): MazeMapFile | null {
    return this.session.mazeMap ?? this.draftMazeMap;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ---- restore / replace / reset -------------------------------------------

  /** Loads the autosave record, if there is one. Returns whether anything was restored. */
  async restore(): Promise<boolean> {
    const record = await this.storage.load();
    // Nothing to restore, and nothing worth overwriting work in memory with.
    if (!record || record.file.videos.length === 0) return false;
    if (this.session.videos.length > 0) return false;
    this.closeAttachments();
    this.session = record.file;
    this.draftMazeMap = record.draftMazeMap;
    this.mazeClicks = { ...record.mazeClicks };
    // Records written before the full working set existed carried only the
    // tracking block; older still, nothing. Neither reverts an edited threshold.
    this.workingParameters =
      record.parameters ??
      (record.trackingParameters
        ? { ...DEFAULT_PARAMETERS, tracking: record.trackingParameters }
        : null);
    this.sessionEpoch += 1;
    this.emit();
    return true;
  }

  /** Replaces everything with a loaded session file. Click counts are not in the file (D47 note). */
  replaceSession(session: SessionFile): void {
    this.closeAttachments();
    this.session = session;
    this.draftMazeMap = null;
    this.workingParameters = null;
    this.mazeClicks = {};
    this.sessionEpoch += 1;
    this.changed();
  }

  /** Clears memory and the autosave record. */
  async reset(): Promise<void> {
    this.closeAttachments();
    this.session = createSessionFile(DEFAULT_SESSION_NAME, this.toolVersion);
    this.draftMazeMap = null;
    this.workingParameters = null;
    this.mazeClicks = {};
    this.sessionEpoch += 1;
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

  // ---- analyses ---------------------------------------------------------------

  analysisFor(videoId: VideoId): VideoAnalysis | undefined {
    return this.session.analyses[videoId];
  }

  /**
   * Records the output of one tracking run. One `auto` layer per video,
   * replaced whole by a later run; `corrections` is carried across untouched,
   * so re-tracking never destroys human work (D9, D25). `derived` is null
   * until an analysis run computes it (D52) — never a placeholder (D16).
   */
  setAutoLayer(videoId: VideoId, auto: AutoLayer): void {
    if (!this.videoById(videoId)) return;
    const existing = this.session.analyses[videoId];
    this.session.analyses = {
      ...this.session.analyses,
      [videoId]: {
        auto,
        corrections: existing?.corrections ?? { entries: [] },
        derived: null,
      },
    };
    this.changed();
  }

  /**
   * Replaces one video's corrections layer (D9, D25). The automatic layer is
   * never touched; the derived cache is left for the caller to recompute.
   */
  setCorrections(videoId: VideoId, corrections: CorrectionsLayer): void {
    const existing = this.session.analyses[videoId];
    if (!existing) return;
    this.session.analyses = {
      ...this.session.analyses,
      [videoId]: { ...existing, corrections },
    };
    this.changed();
  }

  /**
   * Writes the derived cache for one video (D52, D55). Only ever a cache: it is
   * recomputed from `auto ⊕ corrections` on load and never treated as the truth.
   */
  setDerivedLayer(videoId: VideoId, derived: DerivedLayer | null): void {
    const existing = this.session.analyses[videoId];
    if (!existing) return;
    this.session.analyses = {
      ...this.session.analyses,
      [videoId]: { ...existing, derived },
    };
    this.changed();
  }

  // ---- parameters (D51, D55) -------------------------------------------------

  /**
   * The parameters in force: the session file's once the first analysis run
   * has stamped them (D51), the working set edited before that, else the
   * defaults.
   */
  get parameters(): Parameters {
    return this.session.parameters ?? this.workingParameters ?? DEFAULT_PARAMETERS;
  }

  /**
   * Replaces the whole parameter set. Into the session file once stamped, into
   * the working set (remembered across a reload, not written into a downloaded
   * file) before that. An invalid set is refused, so nothing invalid is hashed.
   */
  setParameters(next: Parameters): void {
    assertValidParameters(next);
    if (this.session.parameters !== null) this.session.parameters = next;
    else this.workingParameters = next;
    this.changed();
  }

  /**
   * D51: the first analysis run stamps the parameters in force into the
   * session file, so every derived layer and export from then on names the set
   * it was made with. A no-op once stamped.
   */
  ensureParameters(): Parameters {
    if (this.session.parameters === null) {
      this.session.parameters = this.parameters;
      this.workingParameters = null;
      this.changed();
    }
    return this.session.parameters;
  }

  /** The tracking block of the parameters in force for the next run. */
  get trackingParameters(): TrackingParameters {
    return this.parameters.tracking;
  }

  setTrackingParameters(tracking: TrackingParameters): void {
    this.setParameters({ ...this.parameters, tracking });
  }

  // ---- maze -----------------------------------------------------------------

  /**
   * An uncalibrated map is held back from the session file: D47 makes
   * `mazeMap` null until the maze step is finished, and `platformDiameter_cm`
   * is the one input that finishes it (D14, D44). The draft is still saved to
   * this browser, so a reload does not lose the platform the user just marked.
   */
  setMazeMap(map: MazeMapFile | null): void {
    const calibrated = map !== null && map.calibration.platformDiameter_cm > 0;
    this.session.mazeMap = calibrated ? map : null;
    this.draftMazeMap = calibrated ? null : map;
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
      draftMazeMap: this.draftMazeMap,
      mazeClicks: { ...this.mazeClicks },
      parameters: this.workingParameters,
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

  /**
   * Serialises saves so a fast edit never overtakes a slower earlier write.
   * The record is built when the write actually starts, not when it is queued,
   * so a save waiting behind a slow one still stores the current state rather
   * than the state at the moment it joined the queue.
   */
  private queueSave(): void {
    this.saveChain = this.saveChain
      .then(async () => {
        await this.storage.save(this.toStoredSession());
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
