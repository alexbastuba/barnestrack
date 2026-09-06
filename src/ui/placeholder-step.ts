/**
 * A step whose behaviour lands in a later chunk. It is a real, reachable tab
 * that says what it will do and what it is waiting for, rather than a
 * disabled control that gives the user nothing to read.
 */
import { el } from './dom.js';
import type { Step, StepId } from './step.js';

export function placeholderStep(spec: {
  id: StepId;
  label: string;
  what: string;
  definitions: string[];
  waitingFor: () => string;
}): Step {
  const body = el('div', { class: 'placeholder' });
  return {
    id: spec.id,
    label: spec.label,
    what: spec.what,
    definitions: () => [el('ul', {}, spec.definitions.map((text) => el('li', { text })))],
    body,
    blocked: () => spec.waitingFor(),
    refresh: () => {},
  };
}
