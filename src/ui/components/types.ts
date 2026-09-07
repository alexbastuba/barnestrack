/**
 * What every Review-step panel in this directory is.
 *
 * A component is a function `(container, props, callbacks) → { update, destroy }`:
 * plain DOM, no globals, no session access, no video. Everything it shows comes
 * from its props and everything it wants done leaves through a callback, so the
 * panels can be built and tested before the step that mounts them exists, and
 * mounted without any of them reaching for shared state.
 *
 * Frame numbers crossing this boundary are always a `FrameIndex` — a number from
 * the MP4 sample table, the identity the whole app uses (D7). Several analysis
 * results index the cleaned track by *array position* instead
 * (`TrialBounds.startFrame`, `CleaningReport.outlierFrameIndices`); a component
 * converts those through `cleanedTrack[position].frameIndex` before emitting
 * them, and `positionToFrame` below is that conversion, in one place.
 */
import type { SearchStrategy } from '../../contracts/session.js';
import type { FrameIndex, Track } from '../../contracts/track.js';

/** The handle a caller keeps: new data in, and a way to take the panel down. */
export interface Component<P> {
  /** Re-render from fresh props. Cheap enough to call on every parameter change. */
  update(props: P): void;
  /** Remove the panel's nodes and every listener it added. */
  destroy(): void;
}

/**
 * Announcements leave as a callback rather than through `AppContext`, which a
 * component must not reach: D37 wants every state change in the shell's one
 * polite live region, and only the step that mounts these knows where that is.
 */
export interface AnnounceCallback {
  onAnnounce?(message: string): void;
}

/** Every panel can send the user to a frame. */
export interface SeekCallbacks extends AnnounceCallback {
  onSeek(frame: FrameIndex): void;
}

export interface StrategyCallbacks extends SeekCallbacks {
  /** A human overrules the classifier; the reason is stored with the correction (D23). */
  onOverride(strategy: SearchStrategy, reason: string): void;
  /** Drop a correction by id — here, the strategy override. */
  onRevert(id: string): void;
}

/**
 * The `frameIndex` of a position in the cleaned track, or null when there is no
 * such position. Never guess: a missing position means the value has no frame to
 * seek to, and the caller shows it as plain text instead of a button.
 */
export function positionToFrame(track: Track, position: number | null): FrameIndex | null {
  if (position === null || !Number.isInteger(position) || position < 0) return null;
  return track[position]?.frameIndex ?? null;
}
