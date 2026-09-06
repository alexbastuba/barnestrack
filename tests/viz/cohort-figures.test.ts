import { describe, expect, it } from 'vitest';
import type { SessionFile } from '../../src/contracts/session.js';
import { groupComparison, groupComparisonFigure } from '../../src/viz/group-comparison.js';
import { learningCurveFigure, learningCurveSeries } from '../../src/viz/learning-curve.js';
import type { FigureData, FigureOpts } from '../../src/viz/types.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';
import { fakeContext } from './fake-context.js';

const session = syntheticSession();
const data: FigureData = { session, videoId: 'video-test50' };
const LIGHT: FigureOpts = { scale: 1, theme: 'light' };
const PRINT: FigureOpts = { scale: 1, theme: 'print' };

/** The same cohort with every metadata field cleared. */
function withoutMetadata(): SessionFile {
  return { ...session, videos: session.videos.map((video) => ({ ...video, metadata: {} })) };
}

describe('learningCurveSeries', () => {
  it('groups by animal and lays the fixture out by day', () => {
    const curve = learningCurveSeries(session);
    expect(curve.series.map((series) => series.animal)).toEqual(['M07', 'M12']);
    expect(curve.xAxis).toBe('day');
    expect(curve.xLabels).toEqual(['1', '4']);
  });

  it('gives an animal a point only for the days it has a trial on', () => {
    const curve = learningCurveSeries(session);
    const m07 = curve.series.find((series) => series.animal === 'M07');
    const m12 = curve.series.find((series) => series.animal === 'M12');
    expect(m07?.points.map((point) => point.xLabel)).toEqual(['1']);
    expect(m12?.points.map((point) => point.xLabel)).toEqual(['1', '4']);
  });

  it('falls back to the trial axis when every trial is on one day', () => {
    const oneDay: SessionFile = {
      ...session,
      videos: session.videos.map((video, index) => ({
        ...video,
        metadata: { ...video.metadata, day: '1', trial: String(index + 1) },
      })),
    };
    const curve = learningCurveSeries(oneDay);
    expect(curve.xAxis).toBe('trial');
    expect(curve.xLabels).toEqual(['1', '2', '3']);
  });

  it('leaves a metric with no value null rather than plotting it as zero', () => {
    const curve = learningCurveSeries(session, 'totalLatency_s');
    const m12 = curve.series.find((series) => series.animal === 'M12');
    const day1 = m12?.points.find((point) => point.xLabel === '1');
    expect(day1?.value).toBeNull();
    expect(m12?.points.find((point) => point.xLabel === '4')?.value).toBeGreaterThan(0);
  });

  it('sorts day labels numerically, not as text', () => {
    const many: SessionFile = {
      ...session,
      videos: session.videos.map((video, index) => ({
        ...video,
        metadata: { ...video.metadata, animal: 'M01', day: ['10', '2', '1'][index] },
      })),
    };
    expect(learningCurveSeries(many).xLabels).toEqual(['1', '2', '10']);
  });

  it('has no series at all without metadata', () => {
    expect(learningCurveSeries(withoutMetadata()).series).toEqual([]);
  });
});

describe('learning curve figure', () => {
  it('labels the axes with the metric and its unit, and names every animal', () => {
    const ctx = fakeContext();
    learningCurveFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('Primary latency (s)');
    expect(ctx.joinedText).toContain('Day');
    expect(ctx.joinedText).toContain('M07');
    expect(ctx.joinedText).toContain('M12');
    expect(ctx.saveDepth).toBe(0);
  });

  it('plots whichever metric it is asked for', () => {
    const ctx = fakeContext();
    learningCurveFigure.draw(ctx, { ...data, metric: 'totalErrors' }, LIGHT);
    expect(ctx.joinedText).toContain('Total errors (count)');
  });

  it('tells the user where to add metadata when there is none', () => {
    const ctx = fakeContext();
    const bare = { session: withoutMetadata(), videoId: 'video-test50' };
    expect(learningCurveFigure.unavailable(bare)).toContain('Videos step');
    learningCurveFigure.draw(ctx, bare, LIGHT);
    expect(ctx.joinedText).toContain('Videos');
    expect(ctx.joinedText).toContain('animal');
  });

  it('draws in the print theme without throwing', () => {
    const ctx = fakeContext();
    learningCurveFigure.draw(ctx, data, PRINT);
    expect(ctx.saveDepth).toBe(0);
  });

  it('describes a blank cell rather than a zero for a missing value', () => {
    const description = learningCurveFigure.describe({ ...data, metric: 'totalLatency_s' });
    const m12 = description.rows.find((row) => row[0] === 'M12');
    expect(m12?.[1]).toBeNull();
    expect(m12?.[2]).toBeGreaterThan(0);
  });
});

describe('groupComparison', () => {
  it('splits the fixture into its two groups', () => {
    const comparison = groupComparison(session);
    expect(comparison.groups.map((group) => group.group)).toEqual(['control', 'lesion']);
    expect(comparison.trialCount).toBe(3);
  });

  it('counts a trial with no value as missing rather than averaging in a zero', () => {
    const comparison = groupComparison(session, 'totalLatency_s');
    const control = comparison.groups.find((group) => group.group === 'control');
    expect(control?.missing).toBe(1);
    expect(control?.values).toHaveLength(1);
    expect(control?.mean).toBeGreaterThan(0);
  });

  it('reports no spread for a group of one', () => {
    const comparison = groupComparison(session);
    expect(comparison.groups.find((group) => group.group === 'lesion')?.standardDeviation).toBe(0);
  });
});

describe('group comparison figure', () => {
  it('names every group and legends the mean, the spread and the points', () => {
    const ctx = fakeContext();
    groupComparisonFigure.draw(ctx, data, LIGHT);
    expect(ctx.joinedText).toContain('control');
    expect(ctx.joinedText).toContain('lesion');
    expect(ctx.joinedText).toContain('group mean');
    expect(ctx.joinedText).toContain('± 1 standard deviation');
    expect(ctx.joinedText).toContain('one trial');
  });

  it('needs two trials with metadata and says so when it has fewer', () => {
    const one: SessionFile = {
      ...session,
      videos: session.videos.map((video, index) => ({
        ...video,
        metadata: index === 0 ? video.metadata : {},
      })),
    };
    const bare = { session: one, videoId: 'video-test50' };
    expect(groupComparisonFigure.unavailable(bare)).toContain('Videos step');
    const ctx = fakeContext();
    groupComparisonFigure.draw(ctx, bare, LIGHT);
    expect(ctx.joinedText).toContain('group');
  });

  it('draws in the print theme without throwing', () => {
    const ctx = fakeContext();
    groupComparisonFigure.draw(ctx, data, PRINT);
    expect(ctx.saveDepth).toBe(0);
  });
});
