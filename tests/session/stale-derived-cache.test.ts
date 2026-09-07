/**
 * Trust audit A2, reproduced: the export must never be assembled from a stale
 * derived cache.
 *
 * The original reproduction (`notes/audit/a2-stale-cache-export.ts`, run
 * against the real tracker outputs) walked the UI path — three tracked videos,
 * each visited in Review so each got a derived cache, then one threshold
 * changed while the first video was selected. Only that video was re-derived,
 * so `trials.csv` came out with two distinct `parameters_hash` values: rows
 * whose numbers came from one parameter set beside a `parameters.json` naming
 * another. That is the reconciliation D11 and D12 exist to make possible, so
 * it has to be impossible to break.
 *
 * These tests are the same shape over the committed synthetic fixture, so they
 * run without the sample videos. Two halves: the store can no longer hold a
 * stale cache at all, and the export path checks before it builds.
 */
import { describe, expect, it } from 'vitest';
import { derive, toDerivedLayer } from '../../src/analysis/derive.js';
import { hashParameters, type Parameters } from '../../src/analysis/parameters.js';
import type { SessionFile } from '../../src/contracts/session.js';
import { trialRows } from '../../src/export/rows.js';
import {
  analyseAllVideos,
  analyseMissing,
  analyseVideo,
  prepareExport,
  staleAnalyses,
} from '../../src/session/analyse.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

const TOOL_VERSION = 'barnestrack v0.1.0 (a2test0)';

/** The fixture in a store, with every video derived — what Review leaves behind. */
function loadedStore(): SessionStore {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(syntheticSession());
  analyseAllVideos(store);
  return store;
}

function nudgeThreshold(store: SessionStore): Parameters {
  const next = structuredClone(store.parameters);
  next.holeInvestigation.mergeGap_s = 1;
  return next;
}

/** Every video derived from `auto ⊕ corrections` under the session's own parameters. */
function freshlyDerived(session: SessionFile): SessionFile {
  const analyses = { ...session.analyses };
  for (const video of session.videos) {
    const analysis = analyses[video.id]!;
    const result = derive({
      videoId: video.id,
      auto: analysis.auto,
      corrections: analysis.corrections,
      mazeMap: session.mazeMap!,
      mazeTransform: video.mazeTransform,
      index: { width: video.referenceResolution.width, height: video.referenceResolution.height },
      parameters: session.parameters!,
    });
    analyses[video.id] = { ...analysis, derived: toDerivedLayer(result) };
  }
  return { ...session, analyses };
}

describe('the derived cache cannot go stale (A2)', () => {
  it('drops every derived layer when the shared parameters change (D28, D55)', () => {
    const store = loadedStore();
    expect(store.videos.every((v) => store.analysisFor(v.id)?.derived)).toBe(true);

    store.setParameters(nudgeThreshold(store));

    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived)).toEqual([null, null, null]);
  });

  it('never touches the automatic layer or the corrections doing it (D51)', () => {
    const store = loadedStore();
    const before = store.videos.map((v) => {
      const analysis = store.analysisFor(v.id)!;
      return { auto: analysis.auto, corrections: analysis.corrections };
    });

    store.setParameters(nudgeThreshold(store));

    store.videos.forEach((video, index) => {
      const analysis = store.analysisFor(video.id)!;
      // Identity, not equality: changing an event threshold must not invalidate
      // an hour of tracking, and must not rewrite a single human correction.
      expect(analysis.auto).toBe(before[index]!.auto);
      expect(analysis.corrections).toBe(before[index]!.corrections);
      expect(analysis.corrections.entries.length).toBeGreaterThan(0);
    });
  });

  it('drops them when the maze map or a transform changes', () => {
    const store = loadedStore();
    const map = store.current.mazeMap!;
    store.setMazeMap({ ...map, target: { holeIndex: 12 } });
    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived)).toEqual([null, null, null]);

    analyseAllVideos(store);
    const first = store.videos[0]!;
    store.setMazeTransform(first.id, { ...first.mazeTransform, rotationDeg: 3 });
    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived)).toEqual([null, null, null]);
  });

  it('invalidates before it notifies, so a listener that re-derives is not undone', () => {
    const store = loadedStore();
    // The shell re-derives inside every notification. If a mutator invalidated
    // afterwards it would delete the layer that listener just computed, with no
    // second notification to say so — and the listener's own cache key would
    // still claim it was fresh.
    const seen: (unknown | null)[] = [];
    store.subscribe(() => {
      const first = store.videos[0]!;
      if (!store.analysisFor(first.id)?.derived) analyseAllVideos(store);
      seen.push(store.analysisFor(first.id)?.derived ?? null);
    });

    const first = store.videos[0]!;
    store.setMazeTransform(first.id, { ...first.mazeTransform, rotationDeg: 5 });

    expect(seen.length).toBeGreaterThan(0);
    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived ?? null)).not.toContain(null);
  });

  it('re-derives what it invalidated, so no cache means "needs deriving", not "never analysed"', () => {
    const store = loadedStore();
    const first = store.videos[0]!;
    store.setMazeTransform(first.id, { ...first.mazeTransform, rotationDeg: 2 });
    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived)).toEqual([null, null, null]);

    const run = analyseMissing(store);

    expect(run.runs.size).toBe(3);
    const expected = hashParameters(store.current.parameters!);
    for (const video of store.videos) {
      expect(store.analysisFor(video.id)!.derived!.quality.parametersHash).toBe(expected);
    }
    // And it does no work when every cache is already current.
    expect(analyseMissing(store).runs.size).toBe(0);
  });

  it('does not trust the derived layers in a loaded session file (D9, D55)', () => {
    const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
    const file = syntheticSession();
    expect(file.videos.every((v) => file.analyses[v.id]!.derived !== null)).toBe(true);

    store.replaceSession(file);

    expect(store.videos.map((v) => store.analysisFor(v.id)?.derived)).toEqual([null, null, null]);
  });
});

describe('the export is built from a fresh derive, not a cache (A2)', () => {
  it('leaves trials.csv with one parameters_hash after a threshold change', () => {
    const store = loadedStore();
    store.setParameters(nudgeThreshold(store));
    // The old UI path: only the video on screen in Review is re-derived. Where
    // the audit found two hashes in three rows, the invalidation now leaves the
    // other two videos with no cache at all, so they are simply absent — wrong
    // in a different way, and the reason the export re-derives before it builds.
    analyseVideo(store, store.videos[0]!.id);
    expect(trialRows(store.current, TOOL_VERSION)).toHaveLength(1);

    const readiness = prepareExport(store);

    expect(readiness.blocked).toBeNull();
    expect(readiness.analysed).toBe(3);
    const rows = trialRows(store.current, TOOL_VERSION);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.parametersHash)).size).toBe(1);
    expect(rows[0]!.parametersHash).toBe(hashParameters(store.current.parameters!));
    expect(rows.every((row) => row.holeInvestigationMergeGap_s === 1)).toBe(true);
  });

  it('gives every row the numbers a fresh derive gives', () => {
    const store = loadedStore();
    store.setParameters(nudgeThreshold(store));
    analyseVideo(store, store.videos[0]!.id);
    prepareExport(store);

    const exported = trialRows(store.current, TOOL_VERSION);
    const fresh = trialRows(freshlyDerived(store.current), TOOL_VERSION);

    expect(exported.map((r) => [r.videoId, r.primaryErrors, r.totalErrors])).toEqual(
      fresh.map((r) => [r.videoId, r.primaryErrors, r.totalErrors]),
    );
    expect(exported).toEqual(fresh);
  });

  it('names the videos whose cache disagrees with the parameters in force', () => {
    const session = syntheticSession();
    const other = structuredClone(session.parameters!);
    other.holeInvestigation.mergeGap_s = 1;

    expect(staleAnalyses(session)).toEqual([]);
    expect(staleAnalyses({ ...session, parameters: other })).toEqual(session.videos.map((v) => v.id));
  });

  it('refuses an export from a session that has never been analysed', () => {
    const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });

    const readiness = prepareExport(store);

    expect(readiness.analysed).toBe(0);
    expect(readiness.blocked).toMatch(/no video has been analysed/);
  });
});
