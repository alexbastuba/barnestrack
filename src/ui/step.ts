/**
 * What the shell needs from a step panel, and what a step needs from the shell.
 */
import type { SessionStore } from '../session/session-store.js';
import type { Child } from './dom.js';

export type StepId = 'videos' | 'maze' | 'track' | 'review';

export interface AppContext {
  store: SessionStore;
  /** Says something in the polite live region. Every state change goes through here (D37). */
  announce(message: string): void;
  showStep(id: StepId): void;
  toolVersion: string;
}

export interface Step {
  id: StepId;
  label: string;
  /** The "What this step does" paragraph that opens the panel. */
  what: string;
  /** Contents of the collapsed "Definitions" disclosure. */
  definitions(): Child[];
  /** The step's own content, shown only when `blocked()` is null. */
  body: HTMLElement;
  /** Why this step has nothing to show yet, or null when its inputs are present. */
  blocked(): string | null;
  /**
   * Whether this step's work is finished — every video loaded, every maze set,
   * every video tracked. The stepper says so, and it is what enables the step's
   * "Next step" button. A step that is only *able* to run is `ready`, not done.
   */
  done(): boolean;
  /** What the badge says when `done()`; "done" when a step gives no wording. */
  doneLabel?(): string;
  refresh(): void;
  /** Called when the step becomes visible. */
  onShow?(): void;
}
