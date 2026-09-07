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
  flagLabel,
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
    // test50 reaches the target, so this is a real assertion rather than a
    // conditional that would pass silently if the fixture stopped doing so.
    const event = base.analysis.events.find((e) => e.isTarget);
    expect(event, 'the test50 fixture no longer reaches the target hole').toBeDefined();
    const { button } = mountCard(event!);
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

  it('reads its own contents to a screen reader, evidence included', () => {
    // No aria-label: one would replace the button's contents as its accessible
    // name and hide the evidence, the distances and any review flag — exactly
    // what D19 and D26 require it to say.
    const event = base.analysis.events.find((e) => e.evidence.length > 0)!;
    const { button } = mountCard(event, [
      {
        code: 'physically_unlikely_entry',
        eventId: event.id,
        message: 'A loss of this length at a non-target hole is not an escape (O4).',
      },
    ]);
    expect(button.hasAttribute('aria-label')).toBe(false);

    const name = button.textContent ?? '';
    expect(name).toContain(event.evidence);
    expect(name).toContain(event.minNoseDistance_cm.toFixed(2));
    expect(name).toContain('physically unlikely');
  });

  it('holds only phrasing content, which is all a <button> may contain', () => {
    const { button } = mountCard(base.analysis.events[0]!);
    expect(button.querySelectorAll('p, div, dl, ul, li, table')).toHaveLength(0);
  });

  it('still offers a one-line summary for a caller that needs one', () => {
    const event = base.analysis.events[0]!;
    expect(eventSummary(event)).toContain('automatic');
    expect(eventSummary(event)).toContain(`hole ${event.holeIndex}`);
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
    expect(eventSummary(event)).toContain('corrected by a user');
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

  it('calls a lost-tracking flag what it is, not "physically unlikely"', () => {
    // The four codes that can name an event mean different things. Labelling a
    // tracking failure "physically unlikely" would tell the user the animal did
    // something impossible when the tracker had merely lost it.
    const event = base.analysis.events[1]!;
    const { button } = mountCard(event, [
      {
        code: 'tracking_failure_at_hole',
        eventId: event.id,
        message: 'Tracking was lost for 2.30 s at hole 7 without the signature of an entry.',
      },
    ]);
    const text = button.querySelector('.event-flag')!.textContent ?? '';
    expect(text).toContain('lost at a hole');
    expect(text).not.toContain('physically unlikely');
  });

  it('names every flag code that can reach a card', () => {
    const codes: ReviewFlag['code'][] = [
      'physically_unlikely_entry',
      'tracking_failure_at_hole',
      'orphaned_correction',
      'correction_out_of_range',
    ];
    for (const code of codes) {
      expect(flagLabel(code).length, `${code} has no label`).toBeGreaterThan(0);
    }
    // Each is distinct, so two different findings never read the same.
    expect(new Set(codes.map(flagLabel)).size).toBe(codes.length);
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
