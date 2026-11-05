/**
 * One event, with the evidence it was decided on (D19).
 *
 * "The line between 'investigated' and 'went in' is drawn from evidence the
 * user can inspect" — so the card shows the evidence sentence the detector
 * wrote, both distances it measured, which point it judged on (O16), and the
 * frames it spans, and clicking it selects the event — the one selection the
 * timeline, the events table and `E` also set — and goes to its first frame.
 *
 * The whole card is one `<button>`. That is deliberate: click, Enter and Space
 * then come from the platform rather than from a keydown handler that has to
 * remember which keys count, and the card is reachable by Tab because it is a
 * real control rather than a div with a role bolted on (D37). The actions an
 * event takes (reclassify an inferred entry; in the selected-event panel also
 * Keep and Delete) are buttons *beside* it, in the same list item, because a
 * button cannot hold another.
 *
 * D26 marking: a corrected event is hatched *and* carries the word "user", and
 * every automatic value the correction replaced is written out beside the new
 * one — `auto: hole 12 → user: hole 13` — so nothing is overwritten silently.
 * D67: an escape entry the detector produced is named an inference, and its
 * evidence reads as one (`event-wording.ts`).
 */
import type { EventKind, EventRecord } from '../../contracts/events.js';
import type { ReviewFlag } from '../../analysis/types.js';
import { button, el, uniqueId } from '../dom.js';
import { evidenceWording, eventWording, eventWordingLower, reclassifyRefusal } from '../event-wording.js';
import { FLAG_LABELS, flagLabel } from '../review-reasons.js';
import { formatCm, formatHole, formatSeconds, formatTimeAndFrame } from './format.js';
import type { Component, EventCallbacks } from './types.js';

export { flagLabel };

export interface EventCardProps {
  event: EventRecord;
  /** The whole analysis's flags; the card takes the ones naming its event. */
  flags: readonly ReviewFlag[];
  /** True when a correction reclassified this (former) escape entry as tracking loss. */
  reclassified?: boolean;
  /** True when this is the step's selected event. */
  selected?: boolean;
  /**
   * Why the event is in the review queue and what changes if it is wrong
   * (`review-reasons.ts`), two lines under the title; nothing when the event
   * is not queued.
   */
  reason?: string | null;
  consequence?: string | null;
  /**
   * Which actions sit beside the card. `reclassify` (the list): the one action
   * only an inferred entry has. `all` (the selected-event panel): Keep,
   * Reclassify and Delete, each disabled with its reason on screen when it does
   * not apply (D70).
   */
  actions?: 'reclassify' | 'all';
}

/**
 * Why Keep is off for this event, or null when it can be kept. A confirmation
 * says "the tool's event is right as it stands" (D64): it cannot stand on an
 * event that is already a person's — an edited one, an added one or a marked
 * entry (D57, which by D67 needs no confirmation) — or it would replace that
 * correction with the automatic values without a word.
 */
export function keepRefusal(
  event: Pick<EventRecord, 'kind' | 'source' | 'confirmed'> & Partial<Pick<EventRecord, 'autoShadow'>>,
): string | null {
  if (event.kind === 'tracking_failure') {
    return 'Keep is off for a tracking failure: there is no measurement to confirm. Delete it, or leave it as it is.';
  }
  if (event.confirmed) return 'Already kept: you confirmed this event as it stands.';
  if (event.source === 'corrected') {
    // An edited automatic event has its automatic version beside it; a marked entry or an added
    // event has none, and reverting it would remove it.
    return event.autoShadow != null
      ? 'Keep is off: this event carries your edit. Revert the edit to keep the automatic event instead.'
      : 'Nothing to keep: this event is your own, so there is nothing of the tool’s to confirm.';
  }
  return null;
}

const KIND_WORDS: Record<EventKind, string> = {
  investigation: 'Investigation',
  escape_entry: 'Escape entry',
  tracking_failure: 'Tracking failure',
};

const KEEP_LABEL = 'Keep (K)';
const RECLASSIFY_LABEL = 'Not an entry — tracking loss (L)';
const DELETE_LABEL = 'Delete event (Delete)';

/** The review flags that belong to one event. */
export function flagsForEvent(
  flags: readonly ReviewFlag[],
  eventId: string,
): readonly ReviewFlag[] {
  return flags.filter((flag) => flag.eventId === eventId);
}

/**
 * The `auto: … → user: …` clauses for a corrected event, one per field the
 * correction actually moved. A field the user did not touch produces no clause,
 * so the card does not claim a change that never happened.
 */
export function shadowClauses(event: EventRecord): string[] {
  const shadow = event.autoShadow;
  if (!shadow) return [];
  const clauses: string[] = [];
  if (shadow.holeIndex !== event.holeIndex) {
    clauses.push(`auto: ${formatHole(shadow.holeIndex)} → user: ${formatHole(event.holeIndex)}`);
  }
  if (shadow.startFrame !== event.startFrame) {
    clauses.push(`auto: start frame ${shadow.startFrame} → user: start frame ${event.startFrame}`);
  }
  if (shadow.endFrame !== event.endFrame) {
    clauses.push(`auto: end frame ${shadow.endFrame} → user: end frame ${event.endFrame}`);
  }
  return clauses;
}

/**
 * A one-line description of an event, for a caller that needs one — a log line,
 * a tooltip, a timeline marker. The card itself does *not* use this as an
 * `aria-label`: that would replace the button's contents as its accessible
 * name and hide the evidence, the distances and the review flag from a screen
 * reader, which is exactly what D19 and D26 require it to read out.
 */
export function eventSummary(event: EventRecord): string {
  const target = event.isTarget ? ', the target hole' : '';
  return (
    `${KIND_WORDS[event.kind]} at ${formatHole(event.holeIndex)}${target}, ` +
    `${formatSeconds(event.startTime_s)} to ${formatSeconds(event.endTime_s)}, ` +
    `judged on the ${event.pointUsed}, ${event.source === 'corrected' ? 'corrected by a user' : 'automatic'}.`
  );
}

export function createEventCard(
  container: HTMLElement,
  props: EventCardProps,
  callbacks: EventCallbacks,
  /** `li` for a list (the default), `div` for a card standing on its own. */
  tag: 'li' | 'div' = 'li',
): Component<EventCardProps> {
  let current = props;

  const card = el('button', { class: 'btn-quiet event-card' });
  card.type = 'button';
  card.addEventListener('click', () => {
    if (callbacks.onSelect) {
      // The step selects, seeks and says what was selected.
      callbacks.onSelect(current.event.id);
      return;
    }
    callbacks.onSeek(current.event.startFrame);
    callbacks.onAnnounce?.(
      `Moved to frame ${current.event.startFrame}, the start of this ${eventWordingLower(current.event, current.reclassified)}.`,
    );
  });

  // The actions beside the card. Built once and re-labelled on render, so a
  // button the user is focused on survives a recompute (D37).
  const actions = el('div', { class: 'event-actions', attrs: { role: 'group', 'aria-label': 'Decide this event' } });
  const keepReason = el('p', { class: 'hint event-action-reason', id: uniqueId('event-keep-reason') });
  const keepButton = button(KEEP_LABEL, () => callbacks.onKeep?.(current.event.id), {
    class: 'btn-secondary',
    attrs: { 'aria-keyshortcuts': 'K', 'aria-describedby': keepReason.id },
  });
  const reclassifyButton = button(RECLASSIFY_LABEL, () => callbacks.onReclassify?.(current.event.id), {
    class: 'btn-quiet',
    attrs: { 'aria-keyshortcuts': 'L' },
  });
  const deleteButton = button(DELETE_LABEL, () => callbacks.onDelete?.(current.event.id), {
    class: 'btn-quiet',
    attrs: { 'aria-keyshortcuts': 'Delete' },
  });

  // The flag's full message, one click away (D76): a button cannot hold a
  // `<details>`, so it sits in the item under the card, and the card carries
  // the flag's name.
  const flagDetails = el('details', { class: 'event-flag-details' });
  const flagSummary = el('summary');
  const flagMessages = el('p', { class: 'event-flag-message' });
  flagDetails.append(flagSummary, flagMessages);

  // On the item, not on the button: the button's className is reassigned on
  // every render, and this is what the review queue scrolls to.
  const item = el(tag, { class: 'event-item', attrs: { 'data-event-id': props.event.id } }, [card, flagDetails, actions]);
  container.append(item);

  function renderActions(event: EventRecord): void {
    const mode = current.actions ?? 'reclassify';
    const refusal = reclassifyRefusal(event);
    const children: HTMLElement[] = [];
    if (mode === 'all') {
      const keepNo = keepRefusal(event);
      keepButton.disabled = keepNo !== null || !callbacks.onKeep;
      keepReason.textContent = keepNo ?? '';
      keepReason.hidden = keepNo === null;
      children.push(keepButton);
    }
    // Reclassifying is for an escape entry the tracker inferred only; anything else gets no button
    // rather than a disabled one — a marked entry is undone by reverting its range, and `L` on it
    // says so (`reclassifyRefusal`).
    if (event.kind === 'escape_entry' && callbacks.onReclassify && refusal === null) {
      reclassifyButton.disabled = false;
      children.push(reclassifyButton);
    }
    if (mode === 'all' && callbacks.onDelete) children.push(deleteButton);
    if (mode === 'all') children.push(keepReason);
    actions.replaceChildren(...children);
    actions.hidden = children.length === 0;
  }

  function render(): void {
    const { event, flags } = current;
    const corrected = event.source === 'corrected';
    card.className = `btn-quiet event-card${corrected ? ' is-corrected' : ''}${current.selected ? ' is-selected' : ''}`;
    item.classList.toggle('is-selected', current.selected === true);
    // `aria-current`, not `aria-selected`: the latter is not allowed on a button.
    if (current.selected) card.setAttribute('aria-current', 'true');
    else card.removeAttribute('aria-current');

    // The trailing spaces are not decoration: this text is the button's
    // accessible name, and without them a screen reader reads
    // "Investigationhole 0auto" as one word.
    const head = el('span', { class: 'event-card-head' }, [
      el('span', { class: 'event-kind', text: `${eventWording(event, current.reclassified)} ` }),
      el('span', { class: 'event-hole', text: `${formatHole(event.holeIndex)} ` }),
      event.isTarget && el('span', { class: 'badge badge-ok badge-target', text: 'target' }),
      // The source is a word, not only a hatch: colour and pattern never carry
      // it alone (D26).
      corrected
        ? el('span', { class: 'badge badge-warn badge-user', text: 'user' })
        : el('span', { class: 'badge', text: 'auto' }),
      ' ',
      // A kept event is the user's, but it says the same thing the tool did.
      // The word is there for the same reason "user" is: never colour alone.
      ...(event.confirmed
        ? [el('span', { class: 'badge badge-ok', text: 'confirmed' }), ' ']
        : []),
      ...(current.selected ? [el('span', { class: 'badge badge-selected', text: 'selected' }), ' '] : []),
    ]);

    // Spans, not a <dl>: a button may contain phrasing content only, and its
    // own text is its accessible name — so everything below is read aloud.
    const fact = (term: string, value: string): HTMLElement =>
      el('span', { class: 'event-fact' }, [
        // The colon lives in the text, not in a ::before: CSS content is not
        // part of `textContent`, and this text *is* the button's accessible name.
        el('span', { class: 'event-fact-term', text: `${term}: ` }),
        el('span', { class: 'event-fact-value', text: `${value} ` }),
      ]);

    const facts = el('span', { class: 'event-facts' }, [
      fact('From', formatTimeAndFrame(event.startTime_s, event.startFrame)),
      fact('To', formatTimeAndFrame(event.endTime_s, event.endFrame)),
      fact('Duration', formatSeconds(event.durationSeconds)),
      fact('Judged on', event.pointUsed),
      fact('Min nose distance', formatCm(event.minNoseDistance_cm)),
      fact('Min centroid distance', formatCm(event.minCentroidDistance_cm)),
    ]);

    const children: (Node | false)[] = [head];

    // Why it is in the queue and what it costs if it is wrong, right under the
    // title (chunk 17, §2.4): the two lines a decision is made from.
    if (current.reason) children.push(el('span', { class: 'event-reason', text: `${current.reason} ` }));
    if (current.consequence) children.push(el('span', { class: 'event-consequence', text: `${current.consequence} ` }));

    children.push(facts);

    if (event.evidence) {
      children.push(el('span', { class: 'event-evidence', text: `${evidenceWording(event)} ` }));
    }

    for (const clause of shadowClauses(event)) {
      children.push(el('span', { class: 'event-shadow', text: clause }));
    }

    // The flag's name on the card; its sentence one click away under it (D76).
    const own = flagsForEvent(flags, event.id);
    for (const flag of own) {
      children.push(
        el('span', { class: 'event-flag' }, [
          el('span', { class: 'badge badge-warn badge-flag', text: FLAG_LABELS[flag.code] }),
          ' — review ',
        ]),
      );
    }
    flagDetails.hidden = own.length === 0;
    if (own.length > 0) {
      flagSummary.textContent = `Flag: ${[...new Set(own.map((flag) => FLAG_LABELS[flag.code]))].join(' · ')}`;
      flagMessages.textContent = own.map((flag) => flag.message).join(' ');
    }

    card.replaceChildren(...children.filter((child): child is Node => child !== false));
    renderActions(event);
  }

  render();

  return {
    update(nextProps) {
      current = nextProps;
      render();
    },
    destroy() {
      item.remove();
    },
  };
}
