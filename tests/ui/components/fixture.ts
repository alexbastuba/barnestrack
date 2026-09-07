/**
 * A real `DerivedAnalysis` for the component tests and the dev harness.
 *
 * The components are rendered against the output of `derive()`, not against a
 * hand-written object: a panel that only ever sees a tidy literal is a panel
 * that has never met a NaN latency, an empty gap list or a strategy with no
 * rule fired. `tests/fixtures/synthetic-analysis.ts` supplies the session and
 * the analysis engine supplies the rest.
 */
import { derive, type DeriveInput, type DerivedAnalysis } from '../../../src/analysis/derive.js';
import type { Parameters } from '../../../src/contracts/parameters.js';
import type {
  CorrectionEntry,
  SessionFile,
  VideoDescriptor,
} from '../../../src/contracts/session.js';
import { syntheticSession } from '../../fixtures/synthetic-analysis.js';

/** The three synthetic videos, in session order. */
export const VIDEO_IDS = ['video-test50', 'video-test51', 'video-test53'] as const;
export type FixtureVideoId = (typeof VIDEO_IDS)[number];

export interface Fixture {
  session: SessionFile;
  descriptor: VideoDescriptor;
  parameters: Parameters;
  analysis: DerivedAnalysis;
}

export interface FixtureOptions {
  parameters?: Parameters;
  /** Replaces the fixture's own corrections when given. */
  corrections?: CorrectionEntry[];
}

/**
 * The `DeriveInput` for one video of a session — the shape the Review step and
 * the harness both build, kept in one place so they cannot drift apart.
 */
export function deriveInputFor(
  session: SessionFile,
  videoId: string,
  options: FixtureOptions = {},
): DeriveInput {
  const descriptor = session.videos.find((video) => video.id === videoId);
  if (!descriptor) throw new Error(`no video ${videoId} in the fixture session`);
  const analysis = session.analyses[videoId];
  if (!analysis) throw new Error(`video ${videoId} is not tracked in the fixture session`);
  if (!session.mazeMap) throw new Error('the fixture session has no maze map');
  if (!session.parameters) throw new Error('the fixture session has no parameters');

  return {
    videoId,
    auto: analysis.auto,
    corrections: { entries: options.corrections ?? analysis.corrections.entries },
    mazeMap: session.mazeMap,
    mazeTransform: descriptor.mazeTransform,
    index: descriptor.referenceResolution,
    parameters: options.parameters ?? session.parameters,
  };
}

/** One synthetic video, analysed. */
export function fixture(
  videoId: FixtureVideoId = 'video-test50',
  options: FixtureOptions = {},
): Fixture {
  const session = syntheticSession();
  const input = deriveInputFor(session, videoId, options);
  const descriptor = session.videos.find((video) => video.id === videoId)!;
  return {
    session,
    descriptor,
    parameters: input.parameters,
    analysis: derive(input),
  };
}

/**
 * The same video derived twice, under two parameter sets — the pair the diff
 * badge exists to describe.
 */
export function derivedPair(
  videoId: FixtureVideoId,
  change: (parameters: Parameters) => Parameters,
): { before: DerivedAnalysis; after: DerivedAnalysis; parameters: Parameters } {
  const session = syntheticSession();
  const base = deriveInputFor(session, videoId);
  const parameters = change(base.parameters);
  return {
    before: derive(base),
    after: derive({ ...base, parameters }),
    parameters,
  };
}
