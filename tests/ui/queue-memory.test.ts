// @vitest-environment happy-dom
/**
 * The queue position across a reload (chunk 17, §2.3): remembered per session
 * in `sessionStorage`, dropped when it is not a position, and harmless when
 * storage is missing.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { forgetQueuePosition, recallQueuePosition, rememberQueuePosition } from '../../src/ui/queue-memory.js';

describe('queue memory', () => {
  afterEach(() => sessionStorage.clear());

  it('remembers and recalls a position per session, and forgets it', () => {
    rememberQueuePosition('s1', { videoId: 'v1', eventId: 'auto-investigation-h3-f10', startFrame: 10 });
    rememberQueuePosition('s2', { videoId: 'v9', eventId: 'e', startFrame: 1 });
    expect(recallQueuePosition('s1')).toEqual({ videoId: 'v1', eventId: 'auto-investigation-h3-f10', startFrame: 10 });
    expect(recallQueuePosition('s2')).toEqual({ videoId: 'v9', eventId: 'e', startFrame: 1 });
    expect(recallQueuePosition('s3')).toBeNull();
    forgetQueuePosition('s1');
    expect(recallQueuePosition('s1')).toBeNull();
  });

  it('drops a record that is not a position', () => {
    sessionStorage.setItem('barnestrack:queue-position:s1', 'not json');
    expect(recallQueuePosition('s1')).toBeNull();
    sessionStorage.setItem('barnestrack:queue-position:s1', JSON.stringify({ videoId: 'v', eventId: 3 }));
    expect(recallQueuePosition('s1')).toBeNull();
    sessionStorage.setItem('barnestrack:queue-position:s1', JSON.stringify({ videoId: 'v', eventId: 'e', startFrame: 2.5 }));
    expect(recallQueuePosition('s1')).toBeNull();
  });

  it('keeps only the three fields', () => {
    sessionStorage.setItem('barnestrack:queue-position:s1', JSON.stringify({ videoId: 'v', eventId: 'e', startFrame: 2, extra: true }));
    expect(recallQueuePosition('s1')).toEqual({ videoId: 'v', eventId: 'e', startFrame: 2 });
  });
});
