/**
 * The way forward from a step (D37), in the step's sticky action bar (D72).
 *
 * The stepper's tabs have always been the only way to move between steps,
 * which asks the user to know that step 2 comes after step 1 and to notice
 * when step 1 is finished. Each of the first three steps now ends with a
 * button that says where it goes and is enabled only when this step's work is
 * actually done — and when it is not, says in words what is missing rather
 * than sitting greyed out with no explanation.
 */
import type { VideoDescriptor } from '../contracts/session.js';
import { IDENTITY_TRANSFORM } from '../maze/similarity.js';
import type { SessionStore } from '../session/session-store.js';
import { button, el } from './dom.js';
import type { AppContext, StepId } from './step.js';

/**
 * Why a step is not finished, or null when it is. One string serves both the
 * disabled button's hint and the step's own `done()`, so the badge and the
 * button can never disagree about what is missing.
 */
export function videosMissing(store: SessionStore): string | null {
  return store.videos.length === 0 ? 'Load at least one video to go on.' : null;
}

/**
 * Whether the shared map has been placed in this video's pixels. Without
 * per-video confirmation state — session state, deliberately not built here —
 * this is the honest test available: a video is set when it carries a fitted
 * transform, or when it is the video the map was drawn on and so needs none.
 */
export function mazeSetOnVideo(store: SessionStore, video: VideoDescriptor): boolean {
  const map = store.current.mazeMap;
  if (!map) return false;
  const transform = video.mazeTransform;
  const identity =
    transform.scale === IDENTITY_TRANSFORM.scale &&
    transform.rotationDeg === IDENTITY_TRANSFORM.rotationDeg &&
    transform.translateX === IDENTITY_TRANSFORM.translateX &&
    transform.translateY === IDENTITY_TRANSFORM.translateY;
  if (!identity) return true;
  return (
    video.referenceResolution.width === map.referenceResolution.width &&
    video.referenceResolution.height === map.referenceResolution.height
  );
}

export function mazeSetCount(store: SessionStore): number {
  return store.videos.filter((video) => mazeSetOnVideo(store, video)).length;
}

export function mazeMissing(store: SessionStore): string | null {
  if (store.videos.length === 0) return 'Load a video on the Videos step first.';
  if (store.current.mazeMap === null) {
    return 'Mark the platform and enter its diameter to finish the maze.';
  }
  const set = mazeSetCount(store);
  const total = store.videos.length;
  if (set < total) {
    return `The maze is set on ${set} of ${total} videos. Choose each remaining video above and place the ring in its frame.`;
  }
  return null;
}

export function trackMissing(store: SessionStore): string | null {
  if (store.videos.length === 0) return 'Load a video on the Videos step first.';
  if (store.current.mazeMap === null) return 'Finish the maze on the Maze step first.';
  const tracked = store.videos.filter((video) => store.analysisFor(video.id)?.derived).length;
  const total = store.videos.length;
  if (tracked < total) return `${tracked} of ${total} videos tracked. Run the rest to go on.`;
  return null;
}

/**
 * The step's action bar (D72): a strip stuck to the bottom of the window
 * while its step is shown, holding the step's one primary action, the line
 * that says where the step stands, and the step's secondary navigation where
 * there is one. It is the last thing in the step, so it comes last in tab
 * order; it is `position: sticky` inside the step (app.css), so it never
 * covers a dialog and stops at the end of the step's own content.
 *
 * At 200 % zoom the bar collapses to the primary alone — except that a
 * disabled primary keeps its reason beside it (D70: a disabled button says
 * why), which `has-reason` marks for the stylesheet.
 */
export interface ActionBar {
  element: HTMLElement;
  /** The one-line status the step writes into, or puts its own reason line in. */
  status: HTMLElement;
  /** Puts the step's controls in the bar: secondary navigation first, then the actions. */
  place(secondary: readonly HTMLElement[], actions: readonly HTMLElement[]): void;
  /** True while the primary is disabled and the status is its reason. */
  markReason(isReason: boolean): void;
}

export function createActionBar(label: string): ActionBar {
  const status = el('div', { class: 'hint next-step-hint action-bar-status' });
  const secondarySlot = el('div', { class: 'action-bar-secondary' });
  const actionSlot = el('div', { class: 'action-bar-actions' });
  const element = el('div', { class: 'next-step action-bar', attrs: { role: 'group', 'aria-label': label } }, [
    status,
    secondarySlot,
    actionSlot,
  ]);
  return {
    element,
    status,
    place(secondary, actions) {
      secondarySlot.replaceChildren(...secondary);
      secondarySlot.hidden = secondary.length === 0;
      actionSlot.replaceChildren(...actions);
    },
    markReason(isReason) {
      element.classList.toggle('has-reason', isReason);
    },
  };
}

export interface NextStepButton {
  element: HTMLElement;
  /** `reason` is why the step is not finished, or null when it is. */
  update(reason: string | null): void;
  /** Puts focus on the button, when it is one focus can rest on. */
  focus(): void;
  /** The bar the button sits in, for a step with more than the one action. */
  bar: ActionBar;
  /** The Next-step button itself. */
  control: HTMLButtonElement;
}

/**
 * The Next-step button in its step's action bar. A step whose only action is
 * going on (the Maze step) gets the bar from this alone; a step with an action
 * of its own (Videos, Track) adds it to `bar` and keeps one primary between
 * the two through `update`'s `primary` flag.
 */
export function createNextStepButton(
  context: AppContext,
  target: StepId,
  label: string,
): NextStepButton {
  const control = button(`Next step → ${label}`, () => context.showStep(target), {
    class: 'next-step-button',
  });
  const bar = createActionBar(`${label}: the way on`);
  bar.place([], [control]);
  const hint = bar.status;

  return {
    element: bar.element,
    bar,
    control,
    update(reason: string | null): void {
      const done = reason === null;
      control.disabled = !done;
      // The primary action only when it is actually the next thing to do; a
      // disabled button that still looks like the main action is a lie.
      control.className = done ? 'next-step-button primary btn-primary' : 'next-step-button btn-secondary';
      hint.textContent = done ? '' : reason;
      hint.hidden = done;
      bar.markReason(!done);
    },
    focus(): void {
      // Focusing a disabled button is a no-op that drops focus to <body>, which
      // is the very thing this exists to prevent.
      if (!control.disabled) control.focus();
    },
  };
}
