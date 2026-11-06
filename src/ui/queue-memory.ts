/**
 * Where a reviewer was in the review queue, remembered across a reload of the
 * page (chunk 17, §2.3): the video and the event `]`, `[` or Keep last moved
 * to, so the walk continues there rather than from the top.
 *
 * UI state, not data — `sessionStorage`, keyed by session id, never the
 * session file (`selection-memory.ts` is the precedent and the contracts are
 * unchanged). Storage can be missing or refuse; every access is guarded, and
 * without it the queue simply starts from its head.
 */

const PREFIX = 'barnestrack:queue-position';

export interface QueuePosition {
  videoId: string;
  eventId: string;
  /** The event's first frame, so a position whose event is gone still says where it was. */
  startFrame: number;
}

function key(sessionId: string): string {
  return `${PREFIX}:${sessionId}`;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function rememberQueuePosition(sessionId: string, position: QueuePosition): void {
  try {
    storage()?.setItem(key(sessionId), JSON.stringify(position));
  } catch {
    // Storage refused: the position simply is not remembered.
  }
}

export function forgetQueuePosition(sessionId: string): void {
  try {
    storage()?.removeItem(key(sessionId));
  } catch {
    // Nothing to forget.
  }
}

/** The remembered position, or null; a record that is not one is dropped. */
export function recallQueuePosition(sessionId: string): QueuePosition | null {
  try {
    const raw = storage()?.getItem(key(sessionId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as QueuePosition).videoId === 'string' &&
      typeof (parsed as QueuePosition).eventId === 'string' &&
      Number.isInteger((parsed as QueuePosition).startFrame)
    ) {
      const { videoId, eventId, startFrame } = parsed as QueuePosition;
      return { videoId, eventId, startFrame };
    }
    return null;
  } catch {
    return null;
  }
}
