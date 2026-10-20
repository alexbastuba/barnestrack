// @vitest-environment happy-dom
/**
 * The reviewer (D68): typed once in the session header, kept in the session,
 * written on every correction made after it, and carried through the session
 * file.
 */
import { describe, expect, it } from 'vitest';
import { parseSessionDocument, serializeSessionFile } from '../../src/session/session-file.js';
import { SessionStore } from '../../src/session/session-store.js';
import { MemorySessionStorage } from '../../src/session/storage.js';
import { setTrialStart } from '../../src/session/corrections.js';
import { createReviewerField } from '../../src/ui/reviewer-field.js';
import { syntheticSession } from '../fixtures/synthetic-analysis.js';

function mounted() {
  const store = new SessionStore(new MemorySessionStorage(), 'barnestrack v0.0.0 (test)', { autosaveDelayMs: 0 });
  store.replaceSession(syntheticSession());
  const said: string[] = [];
  const field = createReviewerField(store, (message) => said.push(message));
  document.body.replaceChildren(...field.elements);
  return { store, field, said };
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('change'));
}

describe('the reviewer field', () => {
  it('is labelled as optional', () => {
    const { field } = mounted();
    expect(document.querySelector(`label[for="${field.input.id}"]`)!.textContent).toBe('Reviewer (optional)');
  });

  it('round-trips through the store and the session file, and stamps new corrections', () => {
    const { store, field, said } = mounted();
    type(field.input, '  A. Reviewer ');
    expect(store.current.reviewer).toBe('A. Reviewer');
    expect(said.at(-1)).toContain('Reviewer set to A. Reviewer');

    const video = store.videos[0]!;
    store.setCorrections(
      video.id,
      setTrialStart(store.analysisFor(video.id)!.corrections, 12, { id: 'ts', timestamp: '2026-10-20T12:00:00.000Z' }),
    );
    expect(store.analysisFor(video.id)!.corrections.entries.find((e) => e.id === 'ts')!.reviewer).toBe('A. Reviewer');

    const parsed = parseSessionDocument(serializeSessionFile(store.current));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.session.reviewer).toBe('A. Reviewer');

    // A fresh field over the reloaded session shows the name again.
    if (parsed.ok) store.replaceSession(parsed.session);
    field.input.value = '';
    field.refresh();
    expect(field.input.value).toBe('A. Reviewer');
  });

  it('clears to nobody when emptied', () => {
    const { store, field } = mounted();
    type(field.input, 'Someone');
    type(field.input, '   ');
    expect(store.current.reviewer).toBeNull();
  });
});
