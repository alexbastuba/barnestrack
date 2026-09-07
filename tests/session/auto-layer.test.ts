/**
 * Writing the output of a tracking run into the session (D9, D51, D52).
 *
 * The guarantee that matters: re-tracking a video replaces its automatic layer
 * and leaves every human correction exactly where it was. A tool that loses an
 * afternoon of corrections because someone nudged a threshold is worse than no
 * tool.
 */
import { describe, expect, it } from 'vitest';
import { hashTrackingParameters } from '../../src/analysis/parameters.js';
import { DEFAULT_TRACKING_PARAMETERS } from '../../src/analysis/tracker/params.js';
import type { AutoLayer, CorrectionEntry, SessionFile } from '../../src/contracts/session.js';
import type { TrackFrame } from '../../src/contracts/track.js';
import { parseSessionDocument, serializeSessionFile } from '../../src/session/session-file.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { TOOL_VERSION, fingerprint, fullSession } from './fixtures.js';

function frame(frameIndex: number): TrackFrame {
  return {
    frameIndex,
    t_s: frameIndex / 30,
    centroid: { x: 100 + (frameIndex % 50), y: 120, confidence: 0.9, valid: true, source: 'auto' },
    nose: { x: 106, y: 114, confidence: 0.7, valid: true, source: 'auto' },
    detectionState: 'tracked',
    reason: 'single_blob',
    blobArea_px2: 842,
    boundingBox: { x: 90, y: 108, width: 30, height: 26 },
    noseHeadingConfidence: 0.7,
  };
}

function autoLayer(frameCount: number, hash = 'h1'): AutoLayer {
  return {
    parametersHash: hash,
    frames: Array.from({ length: frameCount }, (_, i) => frame(i)),
  };
}

const correction: CorrectionEntry = {
  kind: 'point',
  id: 'corr_01',
  timestamp: '2026-09-06T12:00:00.000Z',
  source: 'user',
  frameIndex: 7,
  point: 'nose',
  value: { x: 110, y: 118, confidence: 1, valid: true },
};

function storeWithOneVideo(): SessionStore {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION);
  store.addVideo({
    filename: 'test50.mp4',
    fingerprint: fingerprint(),
    referenceResolution: { width: 640, height: 480 },
  });
  return store;
}

describe('setAutoLayer', () => {
  it('creates the analysis entry with derived null (D52)', () => {
    const store = storeWithOneVideo();
    expect(store.analysisFor('vid_01')).toBeUndefined();

    store.setAutoLayer('vid_01', autoLayer(3));

    const analysis = store.analysisFor('vid_01');
    expect(analysis?.auto.frames).toHaveLength(3);
    expect(analysis?.corrections.entries).toEqual([]);
    expect(analysis?.derived).toBeNull();
  });

  it('leaves an existing corrections layer completely untouched when re-tracking (D9)', () => {
    const store = storeWithOneVideo();
    store.setAutoLayer('vid_01', autoLayer(3, 'h1'));

    // A correction made by hand between the two runs.
    const analyses = store.current.analyses;
    analyses['vid_01'] = {
      ...analyses['vid_01']!,
      corrections: { entries: [correction] },
    };

    store.setAutoLayer('vid_01', autoLayer(5, 'h2'));

    const after = store.analysisFor('vid_01');
    expect(after?.corrections.entries).toEqual([correction]);
    expect(after?.auto.frames).toHaveLength(5);
    expect(after?.auto.parametersHash).toBe('h2');
    expect(after?.derived).toBeNull();
  });

  it('keeps one auto layer per video: a new run replaces, never appends', () => {
    const store = storeWithOneVideo();
    store.setAutoLayer('vid_01', autoLayer(3, 'h1'));
    store.setAutoLayer('vid_01', autoLayer(4, 'h2'));
    expect(store.analysisFor('vid_01')?.auto.frames).toHaveLength(4);
    expect(Object.keys(store.current.analyses)).toEqual(['vid_01']);
  });

  it('keys the layer by the tracking parameters hash (D51)', () => {
    const store = storeWithOneVideo();
    const hash = hashTrackingParameters(DEFAULT_TRACKING_PARAMETERS);
    store.setAutoLayer('vid_01', { parametersHash: hash, frames: [frame(0)] });
    expect(store.analysisFor('vid_01')?.auto.parametersHash).toBe(hash);

    const changed = hashTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 6 });
    expect(changed).not.toBe(hash);
  });

  it('ignores a video that is not in the session', () => {
    const store = storeWithOneVideo();
    store.setAutoLayer('vid_99', autoLayer(2));
    expect(store.current.analyses['vid_99']).toBeUndefined();
  });

  it('drops the analysis with the video it belongs to', () => {
    const store = storeWithOneVideo();
    store.setAutoLayer('vid_01', autoLayer(2));
    store.removeVideo('vid_01');
    expect(store.current.analyses['vid_01']).toBeUndefined();
  });
});

describe('working tracking parameters', () => {
  it('starts at the defaults and survives an autosave round trip', async () => {
    const storage = new MemorySessionStorage();
    const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    store.addVideo({
      filename: 'test50.mp4',
      fingerprint: fingerprint(),
      referenceResolution: { width: 640, height: 480 },
    });
    expect(store.trackingParameters).toEqual(DEFAULT_TRACKING_PARAMETERS);

    store.setTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 6.5 });
    await store.flush();

    const reloaded = new SessionStore(storage, TOOL_VERSION);
    expect(await reloaded.restore()).toBe(true);
    expect(reloaded.trackingParameters.minBlobArea_cm2).toBe(6.5);
  });

  it('is not written into the portable session file until the first analysis stamps it (D51)', () => {
    const store = storeWithOneVideo();
    store.setTrackingParameters({ ...DEFAULT_TRACKING_PARAMETERS, minBlobArea_cm2: 6.5 });
    expect(store.current.parameters).toBeNull();
    expect(serializeSessionFile(store.current)).not.toContain('6.5');
    store.ensureParameters();
    expect(store.current.parameters?.tracking.minBlobArea_cm2).toBe(6.5);
    expect(serializeSessionFile(store.current)).toContain('6.5');
  });
});

describe('a full-length auto layer', () => {
  // test50 is 5,539 frames; a cohort session carries several of these.
  const FRAMES = 5539;

  it('round-trips through the session file well inside a tenth of a second', () => {
    const session: SessionFile = { ...fullSession() };
    session.analyses = {
      ...session.analyses,
      vid_02: { auto: autoLayer(FRAMES), corrections: { entries: [] }, derived: null },
    };

    const startedWrite = performance.now();
    const text = serializeSessionFile(session);
    const writeMs = performance.now() - startedWrite;

    const startedRead = performance.now();
    const parsed = parseSessionDocument(text);
    const readMs = performance.now() - startedRead;

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.session.analyses['vid_02']?.auto.frames).toHaveLength(FRAMES);
    expect(parsed.session.analyses['vid_02']?.derived).toBeNull();
    expect(writeMs + readMs).toBeLessThan(200);

    // Recorded so the size is visible rather than a surprise on export.
    const megabytes = text.length / (1024 * 1024);
    console.info(
      `auto layer of ${FRAMES} frames: ${megabytes.toFixed(2)} MB of session JSON, ` +
        `serialize ${writeMs.toFixed(0)} ms, parse ${readMs.toFixed(0)} ms`,
    );
  });
});
