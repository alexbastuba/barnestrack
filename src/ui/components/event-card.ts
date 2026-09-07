/**
 * One event, with the evidence it was decided on (D19).
 *
 * "The line between 'investigated' and 'went in' is drawn from evidence the
 * user can inspect" — so the card shows the evidence sentence the detector
 * wrote, both distances it measured, which point it judged on (O16), and the
 * frames it spans, and clicking it goes to the first of those frames.
 *
 * The whole card is one `<button>`. That is deliberate: click, Enter and Space
 * then come from the platform rather than from a keydown handler that has to
 * remember which keys count, and the card is reachable by Tab because it is a
 * real control rather than a div with a role bolted on (D37).
 *
 * D26 marking: a corrected event is hatched *and* carries the word "user", and
 * every automatic value the correction replaced is written out beside the new
 * one — `auto: hole 12 → user: hole 13` — so nothing is overwritten silently.
 */
import type { EventKind, EventRecord } from '../../contracts/events.js';
import type { ReviewFlag } from '../../analysis/types.js';
import { el } from '../dom.js';
import { formatCm, formatHole, formatSeconds, formatTimeAndFrame } from './format.js';
import type { Component, SeekCallbacks } from './types.js';

export interface EventCardProps {
  event: EventRecord;
  /** The whole analysis's flags; the card takes the ones naming its event. */
  flags: readonly ReviewFlag[];
}

const KIND_WORDS: Record<EventKind, string> = {
  investigation: 'Investigation',
  escape_entry: 'Escape entry',
  tracking_failure: 'Tracking failure',
};

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

/** The label a screen reader hears for the card, and the harness logs. */
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
  callbacks: SeekCallbacks,
): Component<EventCardProps> {
  let current = props;

  const card = el('button', { class: 'event-card' });
  card.type = 'button';
  card.addEventListener('click', () => {
    callbacks.onSeek(current.event.startFrame);
    callbacks.onAnnounce?.(
      `Moved to frame ${current.event.startFrame}, the start of this ${KIND_WORDS[
        current.event.kind
      ].toLowerCase()}.`,
    );
  });

  const item = el('li', { class: 'event-item' }, [card]);
  container.append(item);

  function render(): void {
    const { event, flags } = current;
    const corrected = event.source === 'corrected';
    card.className = `event-card${corrected ? ' is-corrected' : ''}`;
    card.setAttribute('aria-label', eventSummary(event));

    const head = el('div', { class: 'event-card-head' }, [
      el('span', { class: 'event-kind', text: KIND_WORDS[event.kind] }),
      el('span', { class: 'event-hole', text: formatHole(event.holeIndex) }),
      event.isTarget && el('span', { class: 'badge badge-ok badge-target', text: 'target' }),
      // The source is a word, not only a hatch: colour and pattern never carry
      // it alone (D26).
      corrected
        ? el('span', { class: 'badge badge-warn badge-user', text: 'user' })
        : el('span', { class: 'badge', text: 'auto' }),
    ]);

    const facts = el('dl', { class: 'event-facts' }, [
      el('div', {}, [
        el('dt', { text: 'From' }),
        el('dd', { text: formatTimeAndFrame(event.startTime_s, event.startFrame) }),
      ]),
      el('div', {}, [
        el('dt', { text: 'To' }),
        el('dd', { text: formatTimeAndFrame(event.endTime_s, event.endFrame) }),
      ]),
      el('div', {}, [
        el('dt', { text: 'Duration' }),
        el('dd', { text: formatSeconds(event.durationSeconds) }),
      ]),
      el('div', {}, [el('dt', { text: 'Judged on' }), el('dd', { text: event.pointUsed })]),
      el('div', {}, [
        el('dt', { text: 'Min nose distance' }),
        el('dd', { text: formatCm(event.minNoseDistance_cm) }),
      ]),
      el('div', {}, [
        el('dt', { text: 'Min centroid distance' }),
        el('dd', { text: formatCm(event.minCentroidDistance_cm) }),
      ]),
    ]);

    const children: (Node | false)[] = [head, facts];

    if (event.evidence) {
      children.push(el('p', { class: 'event-evidence', text: event.evidence }));
    }

    for (const clause of shadowClauses(event)) {
      children.push(el('p', { class: 'event-shadow', text: clause }));
    }

    for (const flag of flagsForEvent(flags, event.id)) {
      children.push(
        el('p', { class: 'event-flag' }, [
          el('span', { class: 'badge badge-warn badge-unlikely', text: 'physically unlikely' }),
          ` — review. ${flag.message}`,
        ]),
      );
    }

    card.replaceChildren(...children.filter((child): child is Node => child !== false));
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
