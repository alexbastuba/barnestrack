/**
 * The Review step's selected event, remembered across a reload of the page.
 *
 * This is UI state, not data: it lives in the browser's `sessionStorage`,
 * keyed by session id and video id, and is never written to the session file —
 * the data contracts are unchanged. Storage can be missing or refuse (a private
 * window, blocked site data); every access is guarded, and the step works the
 * same without it, starting with nothing selected.
 */

const PREFIX = 'barnestrack:selected-event';

function key(sessionId: string, videoId: string): string {
  return `${PREFIX}:${sessionId}:${videoId}`;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberSelection(sessionId: string, videoId: string, eventId: string): void {
  try {
    storage()?.setItem(key(sessionId, videoId), eventId);
  } catch {
    // Storage refused: the selection simply is not remembered.
  }
}

export function forgetSelection(sessionId: string, videoId: string): void {
  try {
    storage()?.removeItem(key(sessionId, videoId));
  } catch {
    // Nothing to forget.
  }
}

/** The remembered event id, or null. The caller drops it when the event no longer exists. */
export function recallSelection(sessionId: string, videoId: string): string | null {
  try {
    return storage()?.getItem(key(sessionId, videoId)) ?? null;
  } catch {
    return null;
  }
}
