/**
 * Who is reviewing (D68): one optional name per session, in the session header.
 *
 * The store copies it onto every correction written while it is set, so the
 * events table, the no-escape confirmation and the exports (`reviewer`,
 * `no_escape_confirmed_by`) can say whose call each one was. Changing it later
 * does not rewrite corrections already made — they keep the name they were
 * made under. Blank means nobody is named.
 */
import type { SessionStore } from '../session/session-store.js';
import { el } from './dom.js';

export interface ReviewerField {
  /** The label and the input, for the header. */
  elements: HTMLElement[];
  input: HTMLInputElement;
  /** Puts the session's name back in the field, unless the user is typing in it. */
  refresh(): void;
}

export function createReviewerField(store: SessionStore, announce: (message: string) => void): ReviewerField {
  const input = el('input', { id: 'session-reviewer', class: 'session-reviewer' });
  input.type = 'text';
  input.autocomplete = 'name';
  const hint = el('span', {
    id: 'session-reviewer-hint',
    class: 'hint',
    text: 'Written on every correction you make from now on.',
  });
  input.setAttribute('aria-describedby', hint.id);
  input.addEventListener('change', () => {
    const name = input.value.trim();
    store.setReviewer(name === '' ? null : name);
    announce(
      name === ''
        ? 'Reviewer cleared: corrections made from now on name nobody.'
        : `Reviewer set to ${name}: corrections made from now on carry this name.`,
    );
  });

  function refresh(): void {
    if (document.activeElement === input) return;
    input.value = store.current.reviewer ?? '';
  }
  refresh();

  return {
    elements: [el('label', { text: 'Reviewer (optional)', attrs: { for: input.id } }), input, hint],
    input,
    refresh,
  };
}
