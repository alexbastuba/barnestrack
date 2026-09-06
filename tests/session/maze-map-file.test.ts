import { describe, expect, it } from 'vitest';
import { MAZE_MAP_SCHEMA_VERSION } from '../../src/contracts/mazeMap.js';
import { mazeMapFileName, parseMazeMapDocument } from '../../src/session/maze-map-file.js';
import { fullSession, mazeMap } from './fixtures.js';

const serialise = (value: unknown) => JSON.stringify(value);

describe('parseMazeMapDocument', () => {
  it('round-trips a complete map', () => {
    const map = mazeMap();
    const result = parseMazeMapDocument(serialise(map));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.map).toEqual(map);
  });

  it('names a session file offered as a maze map', () => {
    const result = parseMazeMapDocument(serialise(fullSession()));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('session file');
    expect(result.message).toContain('Load session file');
  });

  it('rejects a wrong or missing schema version', () => {
    const newer = parseMazeMapDocument(serialise({ ...mazeMap(), schemaVersion: MAZE_MAP_SCHEMA_VERSION + 1 }));
    expect(newer.ok).toBe(false);
    if (!newer.ok) expect(newer.message).toContain(`version ${MAZE_MAP_SCHEMA_VERSION + 1}`);

    const none = parseMazeMapDocument('{"platform":{}}');
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toContain('no schema version');
  });

  it('rejects a document whose fields are present but empty', () => {
    // The shape that used to be adopted and then rendered as NaN.
    const hollow = {
      schemaVersion: MAZE_MAP_SCHEMA_VERSION,
      referenceResolution: {},
      platform: {},
      holes: {},
      target: {},
      calibration: {},
    };
    const result = parseMazeMapDocument(serialise(hollow));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('video size');
  });

  it('names the first field that is wrong', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ platform: { cx: 1, cy: 2, r: 0 } }, 'no radius'],
      [{ holes: { ...mazeMap().holes, n: 2 } }, 'fewer than three holes'],
      [{ holes: { ...mazeMap().holes, ringRatio: 0 } }, 'no radius'],
      [{ target: { holeIndex: 25 } }, 'not one of its 20 holes'],
      [{ target: { holeIndex: -1 } }, 'not one of its 20 holes'],
      [{ calibration: { platformDiameter_cm: 0 } }, 'not a real measurement'],
      [{ holes: { ...mazeMap().holes, offsets: 'nope' } }, 'not a list'],
    ];
    for (const [patch, expected] of cases) {
      const result = parseMazeMapDocument(serialise({ ...mazeMap(), ...patch }));
      expect(result.ok, JSON.stringify(patch)).toBe(false);
      if (!result.ok) expect(result.message, JSON.stringify(patch)).toContain(expected);
    }
  });

  it('rejects text that is not JSON at all', () => {
    expect(parseMazeMapDocument('not json').ok).toBe(false);
    expect(parseMazeMapDocument('[1,2,3]').ok).toBe(false);
  });

  it('names the file so it cannot be mistaken for a session', () => {
    expect(mazeMapFileName()).toBe('maze-map.mazemap.json');
    expect(mazeMapFileName().endsWith('.barnestrack.json')).toBe(false);
  });
});
