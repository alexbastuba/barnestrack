/**
 * D68: a version-1 session file — the example bundle exactly as 0.1.0 shipped
 * it, copied to `tests/fixtures/` before anything was regenerated — loads,
 * migrates in memory, and re-serialises as version 2; and 0.2.0's engine
 * derives it to the numbers 0.1.0 shipped, apart from the fields the schema
 * added. Nothing automatic and nothing human-made is lost or changed.
 */
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { derive, toDerivedLayer } from '../../src/analysis/derive.js';
import type { EventRecord } from '../../src/contracts/events.js';
import type { TrialMetrics } from '../../src/contracts/metrics.js';
import type { QualityReport } from '../../src/contracts/quality.js';
import {
  SESSION_SCHEMA_VERSION,
  type CorrectionEntry,
  type SessionFile,
} from '../../src/contracts/session.js';
import {
  isSessionId,
  parseSessionDocument,
  serializeSessionFile,
} from '../../src/session/session-file.js';

const FIXTURE = fileURLToPath(
  new URL('../fixtures/example-cohort-v1.barnestrack.json.gz', import.meta.url),
);

interface RawV1 {
  schemaVersion: number;
  toolVersion: string;
  name: string;
  sessionId?: unknown;
  videos: Record<string, unknown>[];
  mazeMap: SessionFile['mazeMap'];
  parameters: SessionFile['parameters'];
  analyses: Record<
    string,
    {
      auto: unknown;
      corrections: { entries: CorrectionEntry[] };
      derived: { metrics: TrialMetrics; events: EventRecord[]; quality: QualityReport } | null;
    }
  >;
}

const text = gunzipSync(readFileSync(FIXTURE)).toString('utf-8');
const raw = JSON.parse(text) as RawV1;

/** The one difference a JSON round trip makes: NaN in memory is null in the file. */
function asWritten<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Fields D65 added or redefined; compared explicitly, not field-for-field. */
const PROVENANCE_FIELDS = new Set([
  'source',
  'autoShadow',
  'evidenceCorrected',
  'correctionIds',
  'confirmed',
]);

function migrated(): SessionFile {
  const parsed = parseSessionDocument(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.session;
}

describe('the version-1 fixture', () => {
  it('is the schema-1 document 0.1.0 shipped, with none of the version-2 fields', () => {
    expect(raw.schemaVersion).toBe(1);
    expect('sessionId' in raw).toBe(false);
    expect(raw.videos.every((video) => !('trialType' in video) && !('targetHole' in video))).toBe(true);
    expect(Object.keys(raw.analyses)).toHaveLength(3);
  });
});

describe('migration to version 2 (D68)', () => {
  it('parses, migrates in memory, and re-serialises as version 2 with the same id', () => {
    const session = migrated();
    expect(session.schemaVersion).toBe(SESSION_SCHEMA_VERSION);
    expect(isSessionId(session.sessionId)).toBe(true);
    expect(session.reviewer).toBeNull();
    for (const video of session.videos) {
      expect(video.trialType).toBe('acquisition');
      expect(video.targetHole).toBeNull();
    }
    for (const analysis of Object.values(session.analyses)) {
      expect(analysis.derived).toBeNull();
      for (const entry of analysis.corrections.entries) expect(entry.reviewer).toBeNull();
    }

    const written = serializeSessionFile(session);
    expect(written).toContain('"schemaVersion": 2');
    const again = parseSessionDocument(written);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.session).toEqual(session);
    expect(again.session.sessionId).toBe(session.sessionId);
    expect(serializeSessionFile(again.session)).toBe(written);
  });

  it('generates the id once per load and never reads one out of a version-1 file', () => {
    const a = migrated();
    const b = migrated();
    expect(a.sessionId).not.toBe(b.sessionId);
  });

  it('changes nothing else: name, tool version, map, parameters, automatic layers and corrections are the version-1 ones', () => {
    const session = migrated();
    expect(session.name).toBe(raw.name);
    expect(session.toolVersion).toBe(raw.toolVersion);
    expect(session.mazeMap).toEqual(raw.mazeMap);
    expect(session.parameters).toEqual(raw.parameters);
    for (const [videoId, analysis] of Object.entries(raw.analyses)) {
      expect(session.analyses[videoId]!.auto).toEqual(analysis.auto);
      expect(session.analyses[videoId]!.corrections.entries).toEqual(
        analysis.corrections.entries.map((entry) => ({ ...entry, reviewer: null })),
      );
    }
  });

  it('derives to the numbers 0.1.0 shipped, apart from the provenance fields D65 added', () => {
    const session = migrated();
    const { mazeMap, parameters } = session;
    if (mazeMap === null || parameters === null) throw new Error('the fixture carries no map');
    for (const video of session.videos) {
      const analysis = session.analyses[video.id]!;
      const old = raw.analyses[video.id]!.derived;
      expect(old, `${video.filename} shipped a derived layer`).not.toBeNull();
      const fresh = asWritten(
        toDerivedLayer(
          derive({
            videoId: video.id,
            auto: analysis.auto,
            corrections: analysis.corrections,
            mazeMap,
            mazeTransform: video.mazeTransform,
            trialType: video.trialType,
            targetHole: video.targetHole,
            index: {
              width: video.referenceResolution.width,
              height: video.referenceResolution.height,
            },
            parameters,
          }),
        ),
      );
      // every metric 0.1.0 wrote, field for field
      for (const key of Object.keys(old!.metrics) as (keyof TrialMetrics)[]) {
        expect(fresh.metrics[key], `${video.filename} metrics.${key}`).toEqual(old!.metrics[key]);
      }
      expect(fresh.quality, `${video.filename} quality`).toEqual(old!.quality);
      // every event, in order, on every field that existed before D65
      expect(fresh.events.map((e) => e.id), `${video.filename} event ids`).toEqual(
        old!.events.map((e) => e.id),
      );
      fresh.events.forEach((event, i) => {
        const before = old!.events[i]! as unknown as Record<string, unknown>;
        for (const key of Object.keys(before)) {
          if (PROVENANCE_FIELDS.has(key)) continue;
          expect((event as unknown as Record<string, unknown>)[key], `${video.filename} ${event.id}.${key}`).toEqual(before[key]);
        }
      });
    }
  });

  it('labels the demo take’s range-asserted entry as the person’s claim, and the investigation it trimmed as evidence-corrected', () => {
    // vid_02 carries one correction: an "in the escape box" range. Under D65 the entry it produces
    // is a human claim, and the investigation at the same hole that the range cut short is the
    // tool's, measured over corrected frames, with the auto-only end as its shadow.
    const session = migrated();
    const withRange = session.videos.find((video) =>
      session.analyses[video.id]!.corrections.entries.some((e) => e.kind === 'range'),
    )!;
    const analysis = session.analyses[withRange.id]!;
    const range = analysis.corrections.entries.find((e) => e.kind === 'range')!;
    const fresh = derive({
      videoId: withRange.id,
      auto: analysis.auto,
      corrections: analysis.corrections,
      mazeMap: session.mazeMap!,
      mazeTransform: withRange.mazeTransform,
      trialType: withRange.trialType,
      targetHole: withRange.targetHole,
      index: withRange.referenceResolution,
      parameters: session.parameters!,
    });
    const old = raw.analyses[withRange.id]!.derived!;

    const entry = fresh.events.find((e) => e.kind === 'escape_entry')!;
    expect(entry).toBeDefined();
    expect(old.events.find((e) => e.id === entry.id)?.source).toBe('auto'); // what 0.1.0 said
    expect(entry.startFrame).toBe(range.startFrame);
    expect(entry.source).toBe('corrected');
    expect(entry.correctionIds).toEqual([range.id]);
    expect(entry.autoShadow).toBeUndefined();

    const trimmed = fresh.events.find((e) => e.kind === 'investigation' && e.evidenceCorrected)!;
    expect(trimmed).toBeDefined();
    expect(trimmed.holeIndex).toBe(entry.holeIndex);
    expect(trimmed.source).toBe('auto');
    expect(trimmed.correctionIds).toEqual([range.id]);
    expect(trimmed.autoShadow).toEqual({
      holeIndex: trimmed.holeIndex,
      startFrame: trimmed.startFrame,
      endFrame: trimmed.endFrame + 1,
    });
    // and nothing else on that video is touched
    const others = fresh.events.filter((e) => e !== entry && e !== trimmed);
    expect(others.every((e) => e.source === 'auto' && !e.evidenceCorrected && e.correctionIds.length === 0)).toBe(true);
  });
});
