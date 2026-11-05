// @vitest-environment happy-dom
/**
 * The shell's scroll padding (chunk 17, §4.3): while a step with an action
 * bar is shown, the document's `scroll-padding-bottom` is that bar's rendered
 * height, so a control focused at the foot of the window is scrolled above
 * the bar and never under it; with no bar, nothing. happy-dom lays nothing
 * out, so the bar's box is stubbed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { mountApp } from '../../src/ui/app.js';
import { el } from '../../src/ui/dom.js';
import type { Step, StepId } from '../../src/ui/step.js';

function fakeStep(id: StepId, barHeight: number | null): Step {
  const body = el('div', { class: `${id}-step` }, [el('p', { text: `${id} content` })]);
  if (barHeight !== null) {
    const bar = el('div', { class: 'next-step action-bar' });
    bar.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 100, bottom: barHeight, width: 100, height: barHeight, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    body.append(bar);
  }
  return {
    id,
    label: id,
    what: '',
    definitions: () => [],
    body,
    blocked: () => null,
    done: () => false,
    refresh: () => {},
  };
}

describe('the shell’s scroll padding follows the shown step’s action bar', () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.documentElement.style.scrollPaddingBottom = '';
  });

  it('is the bar’s height on a step with a bar, and nothing on a step without one', () => {
    const root = el('div');
    document.body.append(root);
    const store = new SessionStore(new MemorySessionStorage(), 'barnestrack v0.0.0 (test)', { autosaveDelayMs: 0 });
    const app = mountApp(root, store, 'barnestrack v0.0.0 (test)', () => [
      fakeStep('videos', 49.5),
      fakeStep('maze', 77),
      fakeStep('track', null),
      fakeStep('review', 96.5),
    ]);
    expect(document.documentElement.style.scrollPaddingBottom).toBe('50px');
    app.showStep('maze');
    expect(document.documentElement.style.scrollPaddingBottom).toBe('77px');
    app.showStep('track');
    expect(document.documentElement.style.scrollPaddingBottom).toBe('');
    app.showStep('review');
    expect(document.documentElement.style.scrollPaddingBottom).toBe('97px');
    // a resize re-reads it
    document.documentElement.style.scrollPaddingBottom = '1px';
    window.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.scrollPaddingBottom).toBe('97px');
  });
});
