/**
 * The analysis wiring (D51, D52, D55): the first derive stamps the parameters
 * into the session file, the derived layer is written as a cache, and a reload
 * restores the corrections and re-derives to the same answer.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMETERS, hashParameters } from '../../src/analysis/parameters.js';
import type { CorrectionEntry } from '../../src/contracts/session.js';
import { analysisBlockedReason, analyseVideo, deriveInputFor } from '../../src/session/analyse.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';
import { TOOL_VERSION } from './fixtures.js';

const VIDEO = 'video-test51';

function storeWithCohort(): { store: SessionStore; storage: MemorySessionStorage } {
  const storage = new MemorySessionStorage();
  const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
  const session = syntheticSession();
  // the fixture ships stamped parameters and a scripted derived layer; the
  // engine's own run starts from neither
  session.parameters = null;
  for (const analysis of Object.values(session.analyses)) analysis.derived = null;
  store.replaceSession(session);
  return { store, storage };
}

describe('analyseVideo', () => {
  it('stamps the parameters in force on the first run (D51) and writes the derived cache (D52)', () => {
    const { store } = storeWithCohort();
    expect(store.current.parameters).toBeNull();
    expect(store.analysisFor(VIDEO)?.derived).toBeNull();

    const run = analyseVideo(store, VIDEO);
    expect(run).not.toBeNull();
    expect(store.current.parameters).toEqual(DEFAULT_PARAMETERS);
    expect(run!.analysis.parametersHash).toBe(hashParameters(DEFAULT_PARAMETERS));
    const cached = store.analysisFor(VIDEO)?.derived;
    expect(cached?.events).toBe(run!.analysis.events);
    expect(cached?.metrics).toBe(run!.analysis.metrics);
    expect(cached?.quality.parametersHash).toBe(run!.analysis.parametersHash);
    expect(run!.deriveMs).toBeGreaterThanOrEqual(0);
  });

  it('stamps a working set edited before the first run, and a later edit goes into the file', () => {
    const { store } = storeWithCohort();
    const edited = {
      ...DEFAULT_PARAMETERS,
      holeInvestigation: { ...DEFAULT_PARAMETERS.holeInvestigation, minDuration_s: 0.4 },
    };
    store.setParameters(edited);
    expect(store.current.parameters).toBeNull(); // not stamped yet
    analyseVideo(store, VIDEO);
    expect(store.current.parameters?.holeInvestigation.minDuration_s).toBe(0.4);

    store.setParameters({ ...edited, trialCutoff_s: 120 });
    expect(store.current.parameters?.trialCutoff_s).toBe(120);
    expect(analyseVideo(store, VIDEO)!.analysis.parametersHash).toBe(
      hashParameters({ ...edited, trialCutoff_s: 120 }),
    );
  });

  it('is null, with a reason, for a video that cannot be analysed yet', () => {
    const storage = new MemorySessionStorage();
    const store = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    expect(analysisBlockedReason(store, 'nope')).toBe('this video is not in the session');
    const { descriptor } = store.addVideo({
      filename: 'x.mp4',
      fingerprint: { byteLength: 1, durationSeconds: 1, frameCount: 1, sha256: 'a'.repeat(64) },
      referenceResolution: { width: 640, height: 480 },
    });
    expect(analysisBlockedReason(store, descriptor.id)).toBe('the maze has not been finished yet');
    expect(deriveInputFor(store, descriptor.id)).toBeNull();
    expect(analyseVideo(store, descriptor.id)).toBeNull();
    expect(store.current.parameters).toBeNull(); // nothing was stamped by a refused run

    const { store: cohort } = storeWithCohort();
    expect(analysisBlockedReason(cohort, VIDEO)).toBeNull();
  });

  it('reads the map, the transform and the resolution from the session, not the attachment', () => {
    const { store } = storeWithCohort();
    const input = deriveInputFor(store, VIDEO)!;
    const video = store.videoById(VIDEO)!;
    expect(input.mazeMap).toBe(store.current.mazeMap);
    expect(input.mazeTransform).toBe(video.mazeTransform);
    expect(input.index).toEqual(video.referenceResolution);
    expect(input.auto).toBe(store.analysisFor(VIDEO)!.auto);
  });

  it('restores corrections through the autosave and re-derives to the same answer (D27, D55)', async () => {
    const { store, storage } = storeWithCohort();
    const first = analyseVideo(store, VIDEO)!.analysis;
    const relabel: CorrectionEntry = {
      kind: 'event',
      id: 'corr-relabel',
      timestamp: '2026-09-06T12:00:00.000Z',
      source: 'user',
      action: 'edit',
      eventId: first.events.find((e) => e.kind === 'investigation')!.id,
      holeIndex: 13,
    };
    store.setCorrections(VIDEO, { entries: [relabel] });
    const corrected = analyseVideo(store, VIDEO)!.analysis;
    expect(corrected.events.some((e) => e.source === 'corrected' && e.holeIndex === 13)).toBe(true);
    await store.flush();

    const reloaded = new SessionStore(storage, TOOL_VERSION, { autosaveDelayMs: 0 });
    expect(await reloaded.restore()).toBe(true);
    expect(reloaded.analysisFor(VIDEO)?.corrections.entries).toEqual([relabel]);
    expect(reloaded.current.parameters).toEqual(DEFAULT_PARAMETERS);
    const again = analyseVideo(reloaded, VIDEO)!.analysis;
    expect(again.events).toEqual(corrected.events);
    expect(again.metrics).toEqual(corrected.metrics);
    expect(again.strategy.reasoning).toEqual(corrected.strategy.reasoning);
  });
});
