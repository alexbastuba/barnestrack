// @vitest-environment happy-dom
/**
 * The event cards and the list around them (D19, D26).
 *
 * The cards are rendered from real `derive()` output wherever possible; the
 * two shapes the synthetic session does not naturally produce — an event whose
 * correction moved its hole, and an event carrying a physically-unlikely review
 * flag — are produced by deriving with a correction that targets a real event
 * id, and by passing a real `ReviewFlag`, rather than by hand-writing an
 * `EventRecord` that has never been through the analysis engine.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReviewFlag } from '../../../src/analysis/types.js';
import type { EventRecord } from '../../../src/contracts/events.js';
import {
  createEventCard,
  eventSummary,
  flagsForEvent,
  shadowClauses,
} from '../../../src/ui/components/event-card.js';
import { createEventList } from '../../../src/ui/components/event-list.js';
import { fixture } from './fixture.js';

const base = fixture('video-test50', { corrections: [] });

/** test50, re-derived with an edit that moves one investigation to the next hole. */
function correctedFixture() {
  const target = base.analysis.events.find(
    (event) => event.kind === 'investigation' && event.holeIndex !== null,
  )!;
  const moved = fixture('video-test50', {
    corrections: [
      {
        id: 'cor-1',
        timestamp: '2026-09-06T10:00:00.000Z',
        source: 'user',
        kind: 'event',
        action: 'edit',
        eventId: target.id,
        holeIndex: (target.holeIndex! + 1) % 20,
      },
    ],
  });
  const event = moved.analysis.events.find((e) => e.source === 'corrected')!;
  return { analysis: moved.analysis, event, autoHole: target.holeIndex! };
}

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => container.remove());

function mountCard(event: EventRecord, flags: readonly ReviewFlag[] = []) {
  const onSeek = vi.fn();
  const onAnnounce = vi.fn();
  const list = document.createElement('ul');
  container.append(list);
  const card = createEventCard(list, { event, flags }, { onSeek, onAnnounce });
  return { card, onSeek, onAnnounce, button: list.querySelector('button')! };
}

describe('an event card', () => {
  it('shows the evidence sentence the detector wrote, verbatim', () => {
    const event = base.analysis.events.find((e) => e.evidence.length > 0)!;
    const { button } = mountCard(event);
    expect(button.querySelector('.event-evidence')!.textContent).toBe(event.evidence);
  });

  it('names the hole, the times, the frames, the duration and both distances', () => {
    const event = base.analysis.events[0]!;
    const { button } = mountCard(event);
    const text = button.textContent ?? '';
    expect(text).toContain(`hole ${event.holeIndex}`);
    expect(text).toContain(`frame ${event.startFrame.toLocaleString()}`);
    expect(text).toContain(`frame ${event.endFrame.toLocaleString()}`);
    expect(text).toContain(event.durationSeconds.toFixed(2));
    expect(text).toContain(event.minNoseDistance_cm.toFixed(2));
    expect(text).toContain(event.minCentroidDistance_cm.toFixed(2));
  });

  it('says which named point the event was judged on (O16)', () => {
    const event = base.analysis.events[0]!;
    const { button } = mountCard(event);
    expect(button.textContent).toContain(event.pointUsed);
  });

  it('marks the target hole with a word, not only a colour', () => {
    const event = base.analysis.events.find((e) => e.isTarget);
    if (!event) return; // test50 reaches the target; guard keeps the test honest if it stops.
    const { button } = mountCard(event);
    expect(button.querySelector('.badge-target')!.textContent).toBe('target');
  });

  it('seeks to the first frame of the event when clicked', () => {
    const event = base.analysis.events[2]!;
    const { onSeek, button } = mountCard(event);
    button.click();
    expect(onSeek).toHaveBeenCalledWith(event.startFrame);
  });

  it('is a real button, so Enter and Space come from the platform', () => {
    const { button } = mountCard(base.analysis.events[0]!);
    expect(button.tagName).toBe('BUTTON');
    expect(button.type).toBe('button');
    expect(button.hasAttribute('tabindex')).toBe(false);
  });

  it('carries a spoken summary for a screen reader', () => {
    const event = base.analysis.events[0]!;
    const { button } = mountCard(event);
    expect(button.getAttribute('aria-label')).toBe(eventSummary(event));
    expect(button.getAttribute('aria-label')).toContain('automatic');
  });
});

describe('an automatic event', () => {
  it('is labelled "auto" and is not hatched', () => {
    const event = base.analysis.events.find((e) => e.source === 'auto')!;
    const { button } = mountCard(event);
    expect(button.classList.contains('is-corrected')).toBe(false);
    expect(button.querySelector('.badge')!.textContent).toBe('auto');
  });
});

describe('a corrected event (D26)', () => {
  it('is hatched and carries the word "user", never colour alone', () => {
    const { event } = correctedFixture();
    const { button } = mountCard(event);
    expect(button.classList.contains('is-corrected')).toBe(true);
    expect(button.querySelector('.badge-user')!.textContent).toBe('user');
    expect(button.getAttribute('aria-label')).toContain('corrected by a user');
  });

  it('writes out the automatic value the correction replaced', () => {
    const { event, autoHole } = correctedFixture();
    const { button } = mountCard(event);
    const shadow = button.querySelector('.event-shadow')!.textContent;
    expect(shadow).toBe(`auto: hole ${autoHole} → user: hole ${event.holeIndex}`);
  });

  it('claims no change for a field the correction did not move', () => {
    const { event } = correctedFixture();
    expect(event.autoShadow).toBeDefined();
    const clauses = shadowClauses(event);
    expect(clauses).toHaveLength(1);
    expect(clauses[0]).toContain('hole');
  });

  it('has no shadow clauses at all for an automatic event', () => {
    expect(shadowClauses(base.analysis.events[0]!)).toEqual([]);
  });
});

describe('a review flag on an event', () => {
  const flag: ReviewFlag = {
    code: 'physically_unlikely_entry',
    eventId: 'will-be-replaced',
    message: 'A loss of this length at a non-target hole is not an escape (O4).',
  };

  it('shows "physically unlikely — review" with the reason on the right card', () => {
    const event = base.analysis.events[1]!;
    const { button } = mountCard(event, [{ ...flag, eventId: event.id }]);
    const text = button.querySelector('.event-flag')!.textContent ?? '';
    expect(text).toContain('physically unlikely');
    expect(text).toContain('review');
    expect(text).toContain(flag.message);
  });

  it('does not put another event’s flag on this card', () => {
    const event = base.analysis.events[1]!;
    const { button } = mountCard(event, [{ ...flag, eventId: 'some-other-event' }]);
    expect(button.querySelector('.event-flag')).toBeNull();
  });

  it('selects flags by event id', () => {
    const flags: ReviewFlag[] = [
      { ...flag, eventId: 'a' },
      { ...flag, eventId: 'b' },
      { code: 'oversized_in_trial', message: 'no event' },
    ];
    expect(flagsForEvent(flags, 'a')).toHaveLength(1);
    expect(flagsForEvent(flags, 'c')).toHaveLength(0);
  });
});

describe('the event list', () => {
  function mountList(analysis = base.analysis, flags: readonly ReviewFlag[] = []) {
    const onSeek = vi.fn();
    const onAnnounce = vi.fn();
    const list = createEventList(
      container,
      { events: analysis.events, flags },
      { onSeek, onAnnounce },
    );
    return { list, onSeek, onAnnounce };
  }

  it('is a real list of one card per event, in the analysis order', () => {
    mountList();
    const cards = container.querySelectorAll('ul.event-list > li');
    expect(cards).toHaveLength(base.analysis.events.length);
    expect(container.querySelector('ul.event-list')).not.toBeNull();
  });

  it('counts every kind, including the ones with none', () => {
    mountList();
    expect(container.querySelector('.event-count')!.textContent).toBe(
      '14 investigations · 0 escape entries · 1 tracking failure',
    );
  });

  it('filters by kind and says how many rows are hidden', () => {
    const { onAnnounce } = mountList();
    const investigations = container.querySelector<HTMLInputElement>('.event-filter input')!;
    investigations.checked = false;
    investigations.dispatchEvent(new Event('change'));

    expect(container.querySelectorAll('ul.event-list > li')).toHaveLength(1);
    const line = container.querySelector('.event-count')!.textContent ?? '';
    expect(line).toContain('14 investigations');
    expect(line).toContain('14 events hidden by the filter');
    expect(onAnnounce).toHaveBeenCalledWith(line);
  });

  it('offers the filter as labelled checkboxes, not a colour key', () => {
    mountList();
    const labels = [...container.querySelectorAll('.event-filter label')].map((n) => n.textContent);
    expect(labels).toEqual(['Investigations', 'Escape entries', 'Tracking failures']);
  });

  it('says so plainly when the filter hides everything', () => {
    mountList();
    for (const box of container.querySelectorAll<HTMLInputElement>('.event-filter input')) {
      box.checked = false;
      box.dispatchEvent(new Event('change'));
    }
    const empty = container.querySelector<HTMLElement>('.empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('hidden by the filter');
  });

  it('distinguishes "no events at all" from "all filtered out"', () => {
    const onSeek = vi.fn();
    createEventList(container, { events: [], flags: [] }, { onSeek });
    const empty = container.querySelector<HTMLElement>('.empty')!;
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toContain('nothing met the definition');
  });

  it('seeks from a card inside the list', () => {
    const { onSeek } = mountList();
    container.querySelector<HTMLButtonElement>('.event-card')!.click();
    expect(onSeek).toHaveBeenCalledWith(base.analysis.events[0]!.startFrame);
  });

  it('re-renders from new props without leaving stale cards behind', () => {
    const { list } = mountList();
    const fewer = base.analysis.events.slice(0, 3);
    list.update({ events: fewer, flags: [] });
    expect(container.querySelectorAll('ul.event-list > li')).toHaveLength(3);
    expect(container.querySelector('.event-count')!.textContent).toContain('3 investigations');
  });

  it('keeps the focused card when an update leaves the event set unchanged', () => {
    const { list } = mountList();
    const card = container.querySelector<HTMLButtonElement>('.event-card')!;
    card.focus();
    expect(document.activeElement).toBe(card);

    // A strategy override re-derives without changing any event; rebuilding the
    // list here would take the user's focus with it (D37).
    list.update({ events: base.analysis.events, flags: [] });

    expect(document.activeElement).toBe(card);
    expect(container.querySelector('.event-card')).toBe(card);
  });

  it('still rebuilds when the events actually changed', () => {
    const { list } = mountList();
    const card = container.querySelector<HTMLButtonElement>('.event-card')!;
    list.update({ events: base.analysis.events.slice(1), flags: [] });
    expect(container.querySelector('.event-card')).not.toBe(card);
    expect(container.querySelectorAll('ul.event-list > li')).toHaveLength(
      base.analysis.events.length - 1,
    );
  });

  it('removes itself on destroy', () => {
    const { list } = mountList();
    list.destroy();
    expect(container.querySelector('.event-panel')).toBeNull();
  });
});
