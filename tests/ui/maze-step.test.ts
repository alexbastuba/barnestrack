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
import { describe, expect, it, vi } from 'vitest';
import { MAZE_MAP_SCHEMA_VERSION, type MazeMapFile } from '../../src/contracts/mazeMap.js';
import type { SessionFile, VideoDescriptor } from '../../src/contracts/session.js';
import { handlePositions, type HandleKind } from '../../src/maze/handles.js';
import { applyTransform } from '../../src/maze/similarity.js';
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
    trialType: 'acquisition',
    targetHole: null,
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

function mount(
  file: SessionFile = session(),
  announce: (message: string) => void = () => {},
): { step: Step; store: SessionStore } {
  const store = new SessionStore(new MemorySessionStorage(), TOOL_VERSION, { autosaveDelayMs: 0 });
  store.replaceSession(file);
  const context: AppContext = {
    store,
    toolVersion: TOOL_VERSION,
    announce,
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

/**
 * Dragging the maze's handles (D69). As with `clickAt`, the overlay is stubbed
 * to sit at the origin at zoom 1, so a client point is a video point; the
 * handle positions come from the same geometry module the step uses.
 */
describe('dragging a handle (D69)', () => {
  const VIDEO_ID = 'video-test53';
  const positions = () => handlePositions(mazeMap().platform, mazeMap().holes);

  /** `rectTop` moves the stubbed stage on the page, as a reflow above it would. */
  function pointer(
    step: Step,
    type: string,
    point: { x: number; y: number },
    extra: Record<string, unknown> = {},
    rectTop = 0,
  ): void {
    const overlay = step.body.querySelector('.overlay-layer')!;
    const rect = { left: 0, top: rectTop, width: 640, height: 480, right: 640, bottom: 480 + rectTop, x: 0, y: rectTop, toJSON: () => ({}) } as DOMRect;
    overlay.getBoundingClientRect = () => rect;
    overlay.parentElement!.getBoundingClientRect = () => rect;
    const event = new Event(type, { bubbles: true, cancelable: true }) as Event & Record<string, unknown>;
    Object.assign(event, { clientX: point.x, clientY: point.y, pointerId: 1, button: 0, shiftKey: false, ...extra });
    overlay.dispatchEvent(event);
  }

  function drag(step: Step, from: { x: number; y: number }, to: { x: number; y: number }): void {
    pointer(step, 'pointerdown', from);
    pointer(step, 'pointermove', to);
    pointer(step, 'pointerup', to);
  }

  /** Along the handle's own radius, so the radial change is exactly `by`. */
  function outward(handle: Exclude<HandleKind, 'centre'>, by: number): { x: number; y: number } {
    const p = positions()[handle];
    const c = positions().centre;
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    return { x: p.x + ((p.x - c.x) / d) * by, y: p.y + ((p.y - c.y) / d) * by };
  }

  function handleButton(step: Step, name: string): HTMLButtonElement {
    const control = [...step.body.querySelectorAll<HTMLButtonElement>('.handle-group button')].find(
      (b) => b.textContent === name,
    );
    expect(control, `no handle button "${name}"`).toBeDefined();
    return control!;
  }

  it('moves this video’s transform by the centre drag, writes the store once and counts one click', () => {
    const { step, store } = mount();
    const writes = vi.spyOn(store, 'setMazeTransform');
    const sharedBefore = store.current.mazeMap!.platform;
    const c = positions().centre;

    drag(step, c, { x: c.x + 40, y: c.y + 25 });

    const transform = store.current.videos[0]!.mazeTransform;
    expect(transform.translateX).toBeCloseTo(40, 6);
    expect(transform.translateY).toBeCloseTo(25, 6);
    expect(transform.scale).toBeCloseTo(1, 9);
    expect(writes).toHaveBeenCalledTimes(1);
    // The shared map is the maze; where it sits in this video is the transform (D49).
    expect(store.current.mazeMap!.platform).toEqual(sharedBefore);
    expect(store.mazeClickCount(VIDEO_ID)).toBe(1);
    expect(fieldNamed(step, 'Centre x (px)').value).toBe((sharedBefore.cx + 40).toFixed(1));
  });

  it('previews in the fields before anything is written', async () => {
    const { step, store } = mount();
    const writes = vi.spyOn(store, 'setMazeTransform');
    const c = positions().centre;

    pointer(step, 'pointerdown', c);
    pointer(step, 'pointermove', { x: c.x + 40, y: c.y + 25 });
    // The preview redraws on the next animation frame.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(fieldNamed(step, 'Centre x (px)').value).toBe((c.x + 40).toFixed(1));
    expect(fieldNamed(step, 'Centre y (px)').value).toBe((c.y + 25).toFixed(1));
    expect(writes).not.toHaveBeenCalled();
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);
    pointer(step, 'pointerup', { x: c.x + 40, y: c.y + 25 });
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('selects the handle on a press that does not move, and counts nothing', () => {
    const { step, store } = mount();
    const before = store.current.videos[0]!.mazeTransform;
    const c = positions().centre;

    pointer(step, 'pointerdown', { x: c.x + 4, y: c.y - 3 });
    pointer(step, 'pointerup', { x: c.x + 4, y: c.y - 3 });

    expect(handleButton(step, 'Centre').getAttribute('aria-pressed')).toBe('true');
    expect(store.current.videos[0]!.mazeTransform).toEqual(before);
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);
  });

  it('treats a move inside the dead zone as that same selecting press', () => {
    const { step, store } = mount();
    const before = store.current.videos[0]!.mazeTransform;
    const c = positions().centre;

    drag(step, c, { x: c.x + 2, y: c.y });

    expect(store.current.videos[0]!.mazeTransform).toEqual(before);
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);
  });

  it('writes the shared ring ratio from the ring-edge handle and leaves the transform alone', async () => {
    const { step, store } = mount();
    const before = store.current.videos[0]!.mazeTransform;
    const r = mazeMap().platform.r;
    const to = outward('ringRim', -10);

    pointer(step, 'pointerdown', positions().ringRim);
    pointer(step, 'pointermove', to);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // The ratio field follows the preview before anything is written.
    expect(fieldNamed(step, 'Ring radius ÷ platform radius').value).toBe((0.89 - 10 / r).toFixed(3));
    expect(store.current.mazeMap!.holes.ringRatio).toBe(0.89);
    pointer(step, 'pointerup', to);

    expect(store.current.mazeMap!.holes.ringRatio).toBeCloseTo(0.89 - 10 / r, 6);
    expect(store.current.videos[0]!.mazeTransform).toEqual(before);
    expect(store.mazeClickCount(VIDEO_ID)).toBe(1);
    expect(fieldNamed(step, 'Ring radius ÷ platform radius').value).toBe((0.89 - 10 / r).toFixed(3));
  });

  it('resizes the platform from the platform-edge handle and keeps the ratio', () => {
    const { step, store } = mount();
    const r = mazeMap().platform.r;

    drag(step, positions().platformRim, outward('platformRim', 20));

    expect(store.current.videos[0]!.mazeTransform.scale).toBeCloseTo((r + 20) / r, 6);
    expect(store.current.mazeMap!.holes.ringRatio).toBe(0.89);
    expect(fieldNamed(step, 'Radius (px)').value).toBe((r + 20).toFixed(1));
  });

  it('maps the drag from the press, so a page reflow under the held pointer is not a move', () => {
    const { step, store } = mount();
    const c = positions().centre;

    pointer(step, 'pointerdown', c);
    // A live-region message of a different height moves the stage up a line
    // while the pointer stays where it is — as the status banner does.
    pointer(step, 'pointermove', { x: c.x + 40, y: c.y + 25 }, {}, -22.5);
    pointer(step, 'pointerup', { x: c.x + 40, y: c.y + 25 }, {}, -22.5);

    const transform = store.current.videos[0]!.mazeTransform;
    expect(transform.translateX).toBeCloseTo(40, 6);
    expect(transform.translateY).toBeCloseTo(25, 6);
  });

  it('keeps the pixel under the pointer when the view zooms mid-drag', () => {
    const { step, store } = mount();
    const c = positions().centre;
    const overlay = step.body.querySelector('.overlay-layer')!;

    pointer(step, 'pointerdown', c);
    // Ctrl with the wheel zooms about the pointer, so the pixel under it stays.
    const wheel = new WheelEvent('wheel', { deltaY: -120, cancelable: true, bubbles: true });
    Object.assign(wheel, { ctrlKey: true, clientX: c.x, clientY: c.y });
    overlay.dispatchEvent(wheel);
    const zoom = 1.1;
    pointer(step, 'pointermove', { x: c.x + 40, y: c.y + 25 });
    pointer(step, 'pointerup', { x: c.x + 40, y: c.y + 25 });

    // Forty screen pixels at the new zoom are 40 / 1.1 video pixels: the
    // centre lands where the pointer let go, not where the old zoom would say.
    const transform = store.current.videos[0]!.mazeTransform;
    expect(transform.translateX).toBeCloseTo(40 / zoom, 6);
    expect(transform.translateY).toBeCloseTo(25 / zoom, 6);
  });

  it('holds the plain wheel while a drag is held, and lets it go after', () => {
    const { step } = mount();
    const c = positions().centre;
    const overlay = step.body.querySelector('.overlay-layer')!;
    const plainWheel = (): WheelEvent => {
      const event = new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true });
      Object.assign(event, { ctrlKey: false, metaKey: false });
      return event;
    };

    pointer(step, 'pointerdown', c);
    const held = plainWheel();
    overlay.dispatchEvent(held);
    expect(held.defaultPrevented).toBe(true);
    pointer(step, 'pointerup', c);

    const released = plainWheel();
    overlay.dispatchEvent(released);
    expect(released.defaultPrevented).toBe(false);
  });

  it('routes a second video’s drags to its own transform and the ring to the shared map', () => {
    const secondVideo: VideoDescriptor = {
      ...video(),
      id: 'video-test54',
      filename: 'test54.mp4',
      fingerprint: { ...video().fingerprint, sha256: 'b'.repeat(64) },
      mazeTransform: { translateX: 12, translateY: -7, rotationDeg: 33, scale: 0.9 },
    };
    const { step, store } = mount(session([video(), secondVideo]));
    const select = step.body.querySelector<HTMLSelectElement>('#maze-video')!;
    select.value = 'video-test54';
    select.dispatchEvent(new Event('change'));
    const firstBefore = store.current.videos[0]!.mazeTransform;
    const sharedBefore = store.current.mazeMap!;
    // Where the shared centre sits in the second video before the drag.
    const shared = { x: sharedBefore.platform.cx, y: sharedBefore.platform.cy };
    const centreBefore = applyTransform(secondVideo.mazeTransform, shared);

    drag(step, centreBefore, { x: centreBefore.x + 40, y: centreBefore.y + 25 });

    const second = store.current.videos[1]!.mazeTransform;
    const centreAfter = applyTransform(second, shared);
    expect(centreAfter.x).toBeCloseTo(centreBefore.x + 40, 6);
    expect(centreAfter.y).toBeCloseTo(centreBefore.y + 25, 6);
    // The placement keeps the ring alignment and the scale this video had.
    expect(second.rotationDeg).toBeCloseTo(33, 6);
    expect(second.scale).toBeCloseTo(0.9, 6);
    // The first video and the shared platform are untouched; the click is this video's.
    expect(store.current.videos[0]!.mazeTransform).toEqual(firstBefore);
    expect(store.current.mazeMap!.platform).toEqual(sharedBefore.platform);
    expect(store.mazeClickCount('video-test54')).toBe(1);
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);

    // The ring edge in this video: on its ring at its bearing, in this video's pixels.
    const videoPlatform = { cx: centreAfter.x, cy: centreAfter.y, r: sharedBefore.platform.r * 0.9 };
    const ringHandle = handlePositions(videoPlatform, sharedBefore.holes).ringRim;
    const d = Math.hypot(ringHandle.x - centreAfter.x, ringHandle.y - centreAfter.y);
    const inward = {
      x: ringHandle.x - ((ringHandle.x - centreAfter.x) / d) * 15,
      y: ringHandle.y - ((ringHandle.y - centreAfter.y) / d) * 15,
    };
    const transformBeforeRing = store.current.videos[1]!.mazeTransform;
    drag(step, ringHandle, inward);
    expect(store.current.mazeMap!.holes.ringRatio).toBeCloseTo(0.89 - 15 / videoPlatform.r, 6);
    expect(store.current.videos[1]!.mazeTransform).toEqual(transformBeforeRing);
  });

  it('places nothing and counts nothing for a drag that comes back to where it started', () => {
    const { step, store } = mount();
    const writes = vi.spyOn(store, 'setMazeTransform');
    const c = positions().centre;

    pointer(step, 'pointerdown', c);
    pointer(step, 'pointermove', { x: c.x + 40, y: c.y + 25 });
    pointer(step, 'pointermove', c);
    pointer(step, 'pointerup', c);

    expect(writes).not.toHaveBeenCalled();
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);
    expect(handleButton(step, 'Centre').getAttribute('aria-pressed')).toBe('true');
  });

  it('puts nothing back and counts nothing when the browser cancels the pointer', () => {
    const { step, store } = mount();
    const before = store.current.videos[0]!.mazeTransform;
    const c = positions().centre;

    pointer(step, 'pointerdown', c);
    pointer(step, 'pointermove', { x: c.x + 40, y: c.y + 25 });
    pointer(step, 'pointercancel', { x: c.x + 40, y: c.y + 25 });

    expect(store.current.videos[0]!.mazeTransform).toEqual(before);
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);
    expect(fieldNamed(step, 'Centre x (px)').value).toBe(mazeMap().platform.cx.toFixed(1));
  });

  it('leaves a Shift press to the pan', () => {
    const { step, store } = mount();
    const c = positions().centre;

    pointer(step, 'pointerdown', c, { shiftKey: true });
    pointer(step, 'pointerup', c, { shiftKey: true });

    expect(handleButton(step, 'Centre').getAttribute('aria-pressed')).toBe('false');
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);
  });

  it('does not claim a press while a click action is armed, so the rim fit keeps its click', () => {
    const { step, store } = mount();
    const before = store.current.videos[0]!.mazeTransform;
    pressButton(step, 'Click 3 points on the platform edge');
    const c = positions().centre;

    drag(step, c, { x: c.x + 40, y: c.y + 25 });

    // One rim point placed, nothing moved.
    expect(store.mazeClickCount(VIDEO_ID)).toBe(1);
    expect(store.current.videos[0]!.mazeTransform).toEqual(before);
    expect(handleButton(step, 'Centre').getAttribute('aria-pressed')).toBe('false');
  });

  it('nudges the selected handle with the arrow keys and clears it with Escape', () => {
    const { step, store } = mount();
    handleButton(step, 'Platform edge').click();
    expect(handleButton(step, 'Platform edge').getAttribute('aria-pressed')).toBe('true');
    const viewport = step.body.querySelector<HTMLElement>('.viewport')!;
    const r = mazeMap().platform.r;

    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(store.current.videos[0]!.mazeTransform.scale).toBeCloseTo((r + 1) / r, 9);
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
    expect(store.current.videos[0]!.mazeTransform.scale).toBeCloseTo((r - 9) / r, 9);
    // Keyboard nudges are not clicks on the image (D50).
    expect(store.mazeClickCount(VIDEO_ID)).toBe(0);

    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(handleButton(step, 'Platform edge').getAttribute('aria-pressed')).toBe('false');
  });

  it('lets a pressed handle button go when pressed again', () => {
    const { step } = mount();
    handleButton(step, 'Ring edge').click();
    expect(handleButton(step, 'Ring edge').getAttribute('aria-pressed')).toBe('true');
    handleButton(step, 'Ring edge').click();
    expect(handleButton(step, 'Ring edge').getAttribute('aria-pressed')).toBe('false');
  });

  it('keeps the radius field’s floor and the platform-edge handle’s floor the same', () => {
    const { step } = mount();
    expect(fieldNamed(step, 'Radius (px)').min).toBe('10');
  });

  it('reads the click count as a status chip, never as a button', () => {
    const { step } = mount();
    const chip = step.body.querySelector('.status-chip');
    expect(chip?.tagName).toBe('P');
    expect(chip?.textContent).toBe('0 clicks on the image');
    expect(step.body.querySelector('.click-badge')).toBeNull();
  });
});

describe('the stage and the action bar (D69, D72)', () => {
  it('stacks the selector, the prompt and the scrubber, the frame and the controls, in that order, with the bar last', () => {
    const { step } = mount();
    const stage = step.body.querySelector('.maze-stage')!;
    expect([...stage.children].map((child) => child.className)).toEqual([
      'maze-stage-top',
      'maze-stage-head',
      'maze-stage-view',
      'maze-controls',
    ]);
    expect(stage.querySelector('.maze-stage-top #maze-video')).not.toBeNull();
    expect(stage.querySelector('.maze-stage-top .status-chip')).not.toBeNull();
    expect(stage.querySelector('.maze-stage-head .mode-status')).not.toBeNull();
    expect(stage.querySelector('.maze-stage-head .scrubber')).not.toBeNull();
    expect(stage.querySelector('.maze-stage-view .canvas-view')).not.toBeNull();
    // Tab order (D72): the stage, the mirror, then the bar as the last thing in the step.
    const last = step.body.lastElementChild!;
    expect(last.classList.contains('next-step')).toBe(true);
    expect(last.previousElementSibling?.classList.contains('mirror')).toBe(true);
    expect(last.previousElementSibling?.previousElementSibling).toBe(stage);
  });

  it('says how far the cohort is in the action bar once every video is set', () => {
    const { step } = mount();
    expect(step.body.querySelector('.maze-progress')).toBeNull();
    const status = step.body.querySelector<HTMLElement>('.next-step .action-bar-status')!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe('Maze set on 1 of 1 video.');
    expect(step.body.querySelector<HTMLButtonElement>('.next-step-button')!.disabled).toBe(false);
  });

  it('leaves the reason, which carries the count, in the bar while a video is still unset', () => {
    // A second video of another size with the identity transform: the map has not been placed in it.
    const second: VideoDescriptor = {
      ...video(),
      id: 'video-test50',
      filename: 'test50.mp4',
      referenceResolution: { width: 1280, height: 720 },
    };
    const { step } = mount(session([video(), second]));
    const status = step.body.querySelector<HTMLElement>('.next-step .action-bar-status')!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).toContain('set on 1 of 2 videos');
    expect(step.body.querySelector<HTMLButtonElement>('.next-step-button')!.disabled).toBe(true);
  });

  it('says where the cohort stands at the end of every announcement that changes the count', () => {
    const second: VideoDescriptor = {
      ...video(),
      id: 'video-test50',
      filename: 'test50.mp4',
      referenceResolution: { width: 1280, height: 720 },
    };
    const announced: string[] = [];
    const { step, store } = mount(session([video(), second]), (message) => announced.push(message));
    const select = step.body.querySelector<HTMLSelectElement>('#maze-video')!;
    select.value = 'video-test50';
    select.dispatchEvent(new Event('change'));
    expect(announced.at(-1)).toBe('Maze step now showing test50.mp4.');

    // Typing a radius places the platform in the second video, which is what sets the maze on it.
    const radius = fieldNamed(step, 'Radius (px)');
    radius.value = '200';
    radius.dispatchEvent(new Event('change'));
    expect(announced.at(-1)).toMatch(/^Platform for test50\.mp4: centre .* radius 200\.0 px\. Maze set on 2 of 2 videos\.$/);
    expect(step.body.querySelector('.next-step .action-bar-status')!.textContent).toBe('Maze set on 2 of 2 videos.');

    // Applying the first video's map to it again changes nothing in the count, and still says so.
    select.value = 'video-test50';
    select.dispatchEvent(new Event('change'));
    const applyFrom = step.body.querySelector<HTMLSelectElement>('#maze-apply-from')!;
    applyFrom.value = 'video-test53';
    pressButton(step, 'Apply map from this video');
    expect(announced.at(-1)).toMatch(/^Maze map applied from test53\.mp4\. .* Maze set on 2 of 2 videos\.$/);
    expect(store.videoById('video-test50')!.mazeTransform).not.toEqual(video().mazeTransform);
  });

  it('says where the cohort stands when the diameter finishes the first map, and not while the map is a draft', () => {
    // Two videos of the map's size and no map yet: the count is 0 of 2 until the diameter lands, then 2 of 2 at once.
    const second: VideoDescriptor = { ...video(), id: 'video-test50', filename: 'test50.mp4' };
    const announced: string[] = [];
    const { step, store } = mount(
      { ...createSessionFile('maze test', TOOL_VERSION), videos: [video(), second], mazeMap: null },
      (message) => announced.push(message),
    );
    expect(store.current.mazeMap).toBeNull();

    const radius = fieldNamed(step, 'Radius (px)');
    radius.value = '200';
    radius.dispatchEvent(new Event('change'));
    // The map is a draft: "Platform set … Maze set on 0 of 2" would contradict itself, so no tail yet.
    expect(announced.at(-1)).toMatch(/^Platform set: .* Enter the platform diameter to finish\.$/);
    expect(announced.at(-1)).not.toContain('Maze set on');
    expect(store.current.mazeMap).toBeNull();

    const diameter = fieldNamed(step, 'Platform diameter (cm)');
    diameter.value = '92';
    diameter.dispatchEvent(new Event('change'));
    expect(announced.at(-1)).toBe('Platform diameter set to 92 cm. Maze set on 2 of 2 videos.');
    expect(store.current.mazeMap).not.toBeNull();
    expect(step.body.querySelector('.next-step .action-bar-status')!.textContent).toBe('Maze set on 2 of 2 videos.');
  });

  it('says where the cohort stands when a ring turn gives a video its own transform, which the count reads as set', () => {
    const second: VideoDescriptor = {
      ...video(),
      id: 'video-test50',
      filename: 'test50.mp4',
      referenceResolution: { width: 1280, height: 720 },
    };
    const announced: string[] = [];
    const { step } = mount(session([video(), second]), (message) => announced.push(message));
    const select = step.body.querySelector<HTMLSelectElement>('#maze-video')!;
    select.value = 'video-test50';
    select.dispatchEvent(new Event('change'));
    expect(step.body.querySelector('.next-step .action-bar-status')!.textContent).toContain('set on 1 of 2 videos');

    const angle = fieldNamed(step, 'Ring angle of hole 0 (°)');
    angle.value = '30';
    angle.dispatchEvent(new Event('change'));
    expect(announced.at(-1)).toMatch(/^Ring aligned on test50\.mp4: hole 0 is now at 30\.0° in this video\. Other videos are unchanged\. Maze set on 2 of 2 videos\.$/);
    expect(step.body.querySelector('.next-step .action-bar-status')!.textContent).toBe('Maze set on 2 of 2 videos.');
  });
});

describe('the mirror table', () => {
  it('right-aligns only the numbers (.num): the two coordinates, not the hole number that names the row', () => {
    const { step } = mount();
    const table = step.body.querySelector('.mirror table')!;
    expect(table.classList.contains('has-num')).toBe(true);
    const headers = [...table.querySelectorAll('thead th')].map((th) => [th.textContent, th.classList.contains('num')]);
    expect(headers).toEqual([
      ['Hole', false],
      ['x (px)', true],
      ['y (px)', true],
      ['Nudged', false],
      ['Target', false],
    ]);
    const row = table.querySelector('tbody tr')!;
    expect(row.querySelector('th')!.classList.contains('num')).toBe(false);
    expect([...row.querySelectorAll('td')].map((td) => td.classList.contains('num'))).toEqual([true, true, false, false]);
  });
});
