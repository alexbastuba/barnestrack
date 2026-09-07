/**
 * The maze the analysis tests share: the 640 × 480 scene of the tracker
 * tests (platform (322, 240) r 205 ≈ 4.457 px/cm for 92 cm), twenty holes on
 * a 0.89 ring, 5 cm holes, hole 0 at 0°.
 */
import type { MazeMapFile, SimilarityTransform } from '../../src/contracts/mazeMap.js';
import { MAZE_MAP_SCHEMA_VERSION } from '../../src/contracts/mazeMap.js';
import { mazeGeometry, type MazeGeometry } from '../../src/analysis/geometry.js';
import {
  DEFAULT_ANALYSIS_OPTIONS,
  DEFAULT_PARAMETERS,
  type AnalysisOptions,
} from '../../src/analysis/parameters.js';
import type { Parameters } from '../../src/contracts/parameters.js';
import { IDENTITY_TRANSFORM } from '../../src/maze/similarity.js';

export const TEST_PLATFORM = { cx: 322, cy: 240, r: 205 };
export const TEST_RESOLUTION = { width: 640, height: 480 };
export const TEST_PLATFORM_DIAMETER_CM = 92;
export const TEST_PX_PER_CM = (2 * TEST_PLATFORM.r) / TEST_PLATFORM_DIAMETER_CM;

export function testMazeMap(overrides: Partial<MazeMapFile> = {}): MazeMapFile {
  return {
    schemaVersion: MAZE_MAP_SCHEMA_VERSION,
    referenceResolution: TEST_RESOLUTION,
    platform: { ...TEST_PLATFORM },
    holes: { n: 20, ringRatio: 0.89, holeRadius_px: 2.5 * TEST_PX_PER_CM, phase_deg: 0 },
    target: { holeIndex: 7 },
    calibration: { platformDiameter_cm: TEST_PLATFORM_DIAMETER_CM },
    createdFrom: 'test-video',
    ...overrides,
  };
}

export function testGeometry(
  overrides: {
    map?: Partial<MazeMapFile>;
    transform?: SimilarityTransform;
    parameters?: Parameters;
    options?: AnalysisOptions;
  } = {},
): MazeGeometry {
  return mazeGeometry({
    map: testMazeMap(overrides.map),
    transform: overrides.transform ?? IDENTITY_TRANSFORM,
    referenceResolution: TEST_RESOLUTION,
    parameters: overrides.parameters ?? DEFAULT_PARAMETERS,
    options: overrides.options ?? DEFAULT_ANALYSIS_OPTIONS,
  });
}
