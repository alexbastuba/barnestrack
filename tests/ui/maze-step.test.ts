// @vitest-environment happy-dom
/**
 * The Maze step's fields and the wheel rule.
 *
 * Alex's trial found two of these: the hole-diameter field did not redraw the
 * overlay until the Calibration section was clicked, and a scroll over the
 * video zoomed it instead of moving the page, so the step could not be scrolled
 * past. happy-dom gives no 2D context, so nothing here checks pixels — what is
 * asserted is that the value reaches the map, and that the page keeps its own
 * wheel events.
 */
import { describe, expect, it } from 'vitest';
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile } from '../../src/contracts/mazeMap.js';
import type { SessionFile, VideoDescriptor } from '../../src/contracts/session.js';
import { createSessionFile } from '../../src/session/session-file.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { createMazeStep } from '../../src/ui/maze-step.js';
import type { AppContext, Step } from '../../src/ui/step.js';

const TOOL_VERSION = 'barnestrack v0.0.0 (test)';

function video(): VideoDescriptor {
  return {
    id: 'video-test53',
    filename: 'test53.mp4',
    fingerprint: { byteLength: 496_723, durationSeconds: 30.2, frameCount: 905, sha256: 'a'.repeat(64) },
    referenceResolution: { width: 640, height: 480 },
    mazeTransform: { translateX: 0, translateY: 0, rotationDeg: 0, scale: 1 },
    metadata: {},
  };
}

/** A finished map: platform, ring and the one calibration input (D14, D44). */
function mazeMap(): MazeMapFile {
  return {
    schemaVersion: MAZE_MAP_SCHEMA_VERSION,
    referenceResolution: { width: 640, height: 480 },
    platform: { cx: 327.8, cy: 239.7, r: 208.5 },
    holes: { n: 20, ringRatio: 0.89, holeRadius_px: 11.3, phase_deg: 0 },
    target: { holeIndex: 0 },
    calibration: { platformDiameter_cm: 92 },
    createdFrom: 'video-test53',
  };
}

function session(videos: VideoDescriptor[] = [video()]): SessionFile {
  return {
    ...createSessionFile('maze test', TOOL_VERSION),
    videos,
    mazeMap: mazeMap(),
  };
}

function mount(file: SessionFile = session()): { step: Step; store: SessionStore } {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(file);
  const context: AppContext = {
    store,
    toolVersion: TOOL_VERSION,
    announce: () => {},
    showStep: () => {},
  };
  const step = createMazeStep(context);
  document.body.replaceChildren(step.body);
  step.refresh();
  return { step, store };
}

function fieldNamed(step: Step, label: string): HTMLInputElement {
  const match = [...step.body.querySelectorAll('label')].find((l) => l.textContent === label);
  expect(match, `no field labelled "${label}"`).toBeDefined();
  return step.body.querySelector<HTMLInputElement>(`#${match!.getAttribute('for')!}`)!;
}

/**
 * A pointer press and release on the overlay at video coordinates. The overlay
 * is stubbed to sit at the origin at zoom 1, which is what `CanvasView` starts
 * at before it is ever laid out, so a client point is a video point.
 */
function clickAt(step: Step, point: { x: number; y: number }): void {
  const overlay = step.body.querySelector('.overlay-layer')!;
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 480, right: 640, bottom: 480, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  const viewport = step.body.querySelector('.canvas-viewport') ?? overlay.parentElement!;
  viewport.getBoundingClientRect = overlay.getBoundingClientRect;
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
    Object.assign(event, { clientX: point.x, clientY: point.y, pointerId: 1, button: 0 });
    overlay.dispatchEvent(event);
  }
}

function pressButton(step: Step, text: string): void {
  const control = [...step.body.querySelectorAll('button')].find((b) => b.textContent === text);
  expect(control, `no button labelled "${text}"`).toBeDefined();
  control!.click();
}

describe('clicking the target hole (D49)', () => {
  const second = (): VideoDescriptor => ({
    ...video(),
    id: 'video-test54',
    filename: 'test54.mp4',
    fingerprint: { ...video().fingerprint, sha256: 'b'.repeat(64) },
  });

  /** Where hole `index` is drawn in the video whose transform is the identity. */
  function holePoint(index: number): { x: number; y: number } {
    const m = mazeMap();
    const radius = m.platform.r * m.holes.ringRatio;
    const angle = ((m.holes.phase_deg + (index * 360) / m.holes.n) * Math.PI) / 180;
    return { x: m.platform.cx + radius * Math.cos(angle), y: m.platform.cy + radius * Math.sin(angle) };
  }

  it('names the shared target on the first click of a map nobody has finished', () => {
    document.body.replaceChildren();
    // No map at all: the one created from the rim clicks carries `target: 0` as
    // the contract's placeholder, and the first target click must name a hole
    // rather than turn the ring onto hole 0.
    const { step, store } = mount({ ...session(), mazeMap: null });
    const circle = mazeMap().platform;

    pressButton(step, 'Click 3 points on the platform edge');
    for (const angle of [0, 120, 240]) {
      const radians = (angle * Math.PI) / 180;
      clickAt(step, {
        x: circle.cx + circle.r * Math.cos(radians),
        y: circle.cy + circle.r * Math.sin(radians),
      });
    }
    expect(store.workingMazeMap).not.toBeNull();
    expect(store.workingMazeMap!.target.holeIndex).toBe(0);

    pressButton(step, 'Click the target hole');
    clickAt(step, holePoint(6));

    expect(store.workingMazeMap!.target.holeIndex).toBe(6);
    // Naming the number is not a rotation: this video's placement is untouched.
    expect(store.current.videos[0]!.mazeTransform.rotationDeg).toBe(0);
  });

  it('names the shared target on the first click and turns only the second video’s ring on the next', () => {
    document.body.replaceChildren();
    const { step, store } = mount(session([video(), second()]));

    // The map came with the session, so it already has a target: hole 0. The
    // first click is on hole 4 of the first video, which the step treats as a
    // turn — so name the target through the field, the shared path, first.
    const targetField = fieldNamed(step, 'Target hole number');
    targetField.value = '4';
    targetField.dispatchEvent(new Event('change'));
    expect(store.current.mazeMap!.target.holeIndex).toBe(4);
    const firstBefore = store.current.videos[0]!.mazeTransform;

    // Second video: click hole 9, five holes on from the target.
    const select = step.body.querySelector<HTMLSelectElement>('#maze-video')!;
    select.value = 'video-test54';
    select.dispatchEvent(new Event('change'));
    pressButton(step, 'Click the target hole');
    clickAt(step, holePoint(9));

    // The shared number is untouched: hole 4 is still the target everywhere.
    expect(store.current.mazeMap!.target.holeIndex).toBe(4);
    const turned = store.current.videos[1]!.mazeTransform;
    expect(turned.rotationDeg).toBeCloseTo(((9 - 4) * 360) / 20, 6);
    // And the first video's placement is exactly as it was.
    expect(store.current.videos[0]!.mazeTransform).toEqual(firstBefore);
  });
});

describe('the hole-diameter field', () => {
  it('reaches the map on every keystroke, without waiting for a blur', () => {
    const { step, store } = mount();
    const input = fieldNamed(step, 'Hole diameter (cm)');
    const before = store.current.mazeMap!.holes.holeRadius_px;

    input.value = '8';
    // `input`, not `change`: `change` fires on blur, which is what used to make
    // the overlay wait until the Calibration section was clicked.
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const after = store.current.mazeMap!.holes.holeRadius_px;
    expect(after).not.toBe(before);
    // 8 cm across a 92 cm platform of radius 208.5 px is about 18 px of radius.
    expect(after).toBeGreaterThan(17);
    expect(after).toBeLessThan(19);
  });

  it('does not snap a half-typed number to the minimum', () => {
    const { step, store } = mount();
    const input = fieldNamed(step, 'Hole diameter (cm)');
    // On the way to "12": below the 0.1 minimum it would be clamped, but "0."
    // is not a number the live path commits at all.
    input.value = '0.05';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(store.current.mazeMap!.holes.holeRadius_px).toBeGreaterThan(5);
  });
});

describe('the ring-ratio field', () => {
  it('steps by 0.005, for the spinner and the arrow keys alike', () => {
    const { step } = mount();
    expect(fieldNamed(step, 'Ring radius ÷ platform radius').step).toBe('0.005');
  });
});

describe('the wheel over the video stage', () => {
  /**
   * happy-dom's WheelEvent constructor drops `ctrlKey` and `metaKey` from its
   * init, so they are assigned onto the instance — the handler reads the
   * properties, which is what a browser gives it either way.
   */
  const wheel = (modifiers: { ctrlKey?: boolean; metaKey?: boolean } = {}): WheelEvent => {
    const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
    Object.assign(event, { ctrlKey: false, metaKey: false, ...modifiers });
    return event;
  };

  it('leaves a plain scroll to the page', () => {
    const { step } = mount();
    const overlay = step.body.querySelector('.overlay-layer')!;
    const event = wheel();
    overlay.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('zooms on Ctrl or ⌘ with the wheel', () => {
    const { step } = mount();
    const overlay = step.body.querySelector('.overlay-layer')!;
    for (const init of [{ ctrlKey: true }, { metaKey: true }]) {
      const event = wheel(init);
      overlay.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
  });

  it('says so in the hint under the stage', () => {
    const { step } = mount();
    const hints = [...step.body.querySelectorAll('.hint')].map((h) => h.textContent ?? '');
    expect(hints.some((text) => text.includes('Ctrl or ⌘ with the scroll wheel zooms'))).toBe(true);
  });
});
