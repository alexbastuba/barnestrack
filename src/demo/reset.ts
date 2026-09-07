/**
 * "Start over" — deliberately not implemented here.
 *
 * Chunk 3 already built exactly what the demo needs, and duplicating it would
 * give the app two reset paths that could drift apart. The single path is:
 *
 *   `Reset session` in the app shell's session controls (`src/ui/app.ts`)
 *     → an inline confirmation, "Delete every video, the maze and all corrections?"
 *     → `SessionStore.reset()` (`src/session/session-store.ts`), which closes
 *       every attachment, replaces the session with a fresh one, clears the maze
 *       draft, tracking parameters and click counts, bumps the epoch, cancels
 *       the pending autosave and clears the IndexedDB record
 *     → back to the Videos step, announced through the live region.
 *
 * That clears IndexedDB *and* memory and returns to the Videos step, which is
 * the whole of what the demo state requires — including after an example cohort
 * has been loaded, since the example arrives through `replaceSession` like any
 * other session file and carries no special state to unwind.
 *
 * This module re-exports the labels so the browser smoke test and any future
 * caller name the control in one place rather than three.
 */

/** The control in the app shell's session controls. */
export const RESET_BUTTON_LABEL = 'Reset session';

/** The inline confirmation it opens. */
export const RESET_CONFIRM_TEXT = 'Delete every video, the maze and all corrections?';
export const RESET_CONFIRM_ACCEPT_LABEL = 'Yes, reset everything';
export const RESET_CONFIRM_CANCEL_LABEL = 'Cancel';

/** What the live region says once it has run. */
export const RESET_ANNOUNCEMENT = 'Session reset. No videos, no maze, no corrections.';
