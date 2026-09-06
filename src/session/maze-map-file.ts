/**
 * Reading a maze map file. D10, D29.
 *
 * A map travels between machines, so it is parsed the way a session file is
 * (`session-file.ts`): every field the contract requires is checked, and a
 * document that is the *other* kind of BarnesTrack file is named rather than
 * described as broken.
 */
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile } from '../contracts/mazeMap.js';

export const MAZE_MAP_FILE_SUFFIX = '.mazemap.json';

export type ParsedMazeMap = { ok: true; map: MazeMapFile } | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function mazeMapFileName(): string {
  return `maze-map${MAZE_MAP_FILE_SUFFIX}`;
}

export function parseMazeMapDocument(text: string): ParsedMazeMap {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: 'That file is not valid JSON, so it cannot be a maze map.' };
  }
  if (!isRecord(value)) return { ok: false, message: 'That file does not contain a maze map.' };

  if (Array.isArray(value['videos']) && isRecord(value['analyses'])) {
    return {
      ok: false,
      message:
        'That is a BarnesTrack session file, not a maze map. Load it with "Load session file" at the top of the page.',
    };
  }

  const version = value['schemaVersion'];
  if (typeof version !== 'number') {
    return { ok: false, message: 'That file is not a BarnesTrack maze map: it has no schema version.' };
  }
  if (version !== MAZE_MAP_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `That maze map uses schema version ${version}; this build of BarnesTrack reads version ${MAZE_MAP_SCHEMA_VERSION}.`,
    };
  }

  const problem = fieldProblem(value);
  if (problem) {
    return {
      ok: false,
      message: `That maze map says it is schema version ${MAZE_MAP_SCHEMA_VERSION}, but ${problem}. It may have been edited by hand or truncated.`,
    };
  }
  return { ok: true, map: value as unknown as MazeMapFile };
}

/** Names the first field that is missing or the wrong shape, in the user's words. */
function fieldProblem(value: Record<string, unknown>): string | null {
  const resolution = value['referenceResolution'];
  if (!isRecord(resolution) || !isFiniteNumber(resolution['width']) || !isFiniteNumber(resolution['height'])) {
    return 'it does not say what video size it was made at';
  }

  const platform = value['platform'];
  if (!isRecord(platform) || !isFiniteNumber(platform['cx']) || !isFiniteNumber(platform['cy'])) {
    return 'its platform has no centre';
  }
  if (!isFiniteNumber(platform['r']) || platform['r'] <= 0) return 'its platform has no radius';

  const holes = value['holes'];
  if (!isRecord(holes)) return 'it has no hole ring';
  if (!isFiniteNumber(holes['n']) || holes['n'] < 3) return 'its hole ring has fewer than three holes';
  if (!isFiniteNumber(holes['ringRatio']) || holes['ringRatio'] <= 0) return 'its hole ring has no radius';
  if (!isFiniteNumber(holes['holeRadius_px'])) return 'its holes have no size';
  if (!isFiniteNumber(holes['phase_deg'])) return 'its hole ring has no angle';
  if (holes['offsets'] !== undefined && !Array.isArray(holes['offsets'])) {
    return 'its per-hole nudges are not a list';
  }

  const target = value['target'];
  if (!isRecord(target) || !isFiniteNumber(target['holeIndex'])) return 'it names no target hole';
  if (target['holeIndex'] < 0 || target['holeIndex'] >= holes['n']) {
    return `its target hole ${target['holeIndex']} is not one of its ${holes['n']} holes`;
  }

  const calibration = value['calibration'];
  if (!isRecord(calibration) || !isFiniteNumber(calibration['platformDiameter_cm'])) {
    return 'it has no platform diameter';
  }
  if (calibration['platformDiameter_cm'] <= 0) return 'its platform diameter is not a real measurement';

  return null;
}
