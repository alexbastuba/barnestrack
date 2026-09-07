/**
 * Every event of a trial, filterable by kind, with a count line (D19).
 *
 * A real `<ul>` of real buttons: a screen reader is told how many events there
 * are before it starts through them, and the filter is a `<fieldset>` of
 * checkboxes rather than a legend of colours, so which kinds are showing is
 * readable in grayscale and audible (D26, D37).
 *
 * The count line always states all three kinds, zero included, and says
 * separately how many rows the filter is hiding — a list that silently shows
 * fewer events than the trial has is the one way this panel could mislead.
 */
import type { EventKind, EventRecord } from '../../contracts/events.js';
import type { ReviewFlag } from '../../analysis/types.js';
import { el, replaceChildren, uniqueId } from '../dom.js';
import { describeEventCounts } from './describe-diff.js';
import { createEventCard } from './event-card.js';
import type { Component, SeekCallbacks } from './types.js';
import { pluralise } from './format.js';
import './review-components.css';

export interface EventListProps {
  events: readonly EventRecord[];
  flags: readonly ReviewFlag[];
}

const KINDS: readonly EventKind[] = ['investigation', 'escape_entry', 'tracking_failure'];

const KIND_LABELS: Record<EventKind, string> = {
  investigation: 'Investigations',
  escape_entry: 'Escape entries',
  tracking_failure: 'Tracking failures',
};

export function createEventList(
  container: HTMLElement,
  props: EventListProps,
  callbacks: SeekCallbacks,
): Component<EventListProps> {
  let current = props;
  const shown = new Set<EventKind>(KINDS);
  const cards = new Map<string, ReturnType<typeof createEventCard>>();
  /** The ids currently in the list, in the order they are rendered. */
  let order: string[] = [];

  const root = el('section', { class: 'review-panel event-panel' });
  const headingId = uniqueId('events-heading');
  root.setAttribute('aria-labelledby', headingId);
  root.append(
    el('h3', { id: headingId, text: 'Events' }),
    el('p', {
      class: 'what',
      text: 'Each event with the evidence it was decided on: where the animal was, how long it stayed, which point the distance was judged on, and — for a loss of detection — what happened either side of it (D19). Selecting an event moves the video to its first frame.',
    }),
  );

  const filter = el('fieldset', { class: 'event-filter' }, [el('legend', { text: 'Show' })]);
  for (const kind of KINDS) {
    const input = el('input', { id: uniqueId('event-filter') });
    input.type = 'checkbox';
    input.checked = true;
    input.addEventListener('change', () => {
      if (input.checked) shown.add(kind);
      else shown.delete(kind);
      render();
      callbacks.onAnnounce?.(countLine());
    });
    filter.append(
      el('span', { class: 'event-filter-option' }, [
        input,
        el('label', { text: KIND_LABELS[kind], attrs: { for: input.id } }),
      ]),
    );
  }
  root.append(filter);

  const counts = el('p', {
    class: 'event-count',
    attrs: { role: 'status', 'aria-live': 'polite' },
  });
  const list = el('ul', { class: 'event-list' });
  const empty = el('p', { class: 'empty', attrs: { hidden: true } });
  root.append(counts, empty, list);
  container.append(root);

  function visible(): EventRecord[] {
    return current.events.filter((event) => shown.has(event.kind));
  }

  function countLine(): string {
    const hidden = current.events.length - visible().length;
    const base = describeEventCounts(current.events);
    if (hidden === 0) return base;
    return `${base} · ${pluralise(hidden, 'event')} hidden by the filter`;
  }

  function render(): void {
    counts.textContent = countLine();

    const events = visible();
    const wanted = events.map((event) => event.id);
    const wantedSet = new Set(wanted);

    for (const [id, card] of cards) {
      if (!wantedSet.has(id)) {
        card.destroy();
        cards.delete(id);
      }
    }

    // Cards that survive are updated in place rather than rebuilt. A parameter
    // change re-renders this list, and rebuilding a card the user is standing
    // on would take their focus with it (D37) — so the DOM is only rewritten
    // when the set or the order of events actually changed.
    const sameOrder = order.length === wanted.length && order.every((id, i) => id === wanted[i]);

    if (sameOrder) {
      for (const event of events) cards.get(event.id)!.update({ event, flags: current.flags });
    } else {
      replaceChildren(list, []);
      for (const event of events) {
        const existing = cards.get(event.id);
        if (existing) existing.destroy();
        cards.set(event.id, createEventCard(list, { event, flags: current.flags }, callbacks));
      }
      order = wanted;
    }

    const nothing = events.length === 0;
    empty.hidden = !nothing;
    list.hidden = nothing;
    empty.textContent =
      current.events.length === 0
        ? 'No events in this trial. With the thresholds as they are, nothing met the definition of an investigation, an entry or a tracking failure.'
        : 'Every event is hidden by the filter above.';
  }

  render();

  return {
    update(nextProps) {
      current = nextProps;
      render();
    },
    destroy() {
      for (const card of cards.values()) card.destroy();
      cards.clear();
      root.remove();
    },
  };
}
