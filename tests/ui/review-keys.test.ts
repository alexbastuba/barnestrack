/**
 * The Review step's keyboard map (D24, D37): one table drives the handler and
 * the legend; every correction is reachable from the keyboard; the arrow keys
 * mean one thing in each context.
 */
import { describe, expect, it } from 'vitest';
import {
  REVIEW_KEYS,
  keyLegend,
  resolveKey,
  type KeyContext,
  type ReviewAction,
} from '../../src/ui/review-keys.js';

const idle: KeyContext = { pointTool: false, edgeSelected: false };
const armed: KeyContext = { pointTool: true, edgeSelected: false };
const edge: KeyContext = { pointTool: false, edgeSelected: true };

function press(key: string, shift = false, extra: Partial<Parameters<typeof resolveKey>[0]> = {}) {
  return { key, shiftKey: shift, altKey: false, ctrlKey: false, metaKey: false, ...extra };
}

describe('REVIEW_KEYS', () => {
  it('binds every action the step exposes, and never two actions to one key in one context', () => {
    const actions = new Set(REVIEW_KEYS.map((b) => b.action));
    const expected: ReviewAction[] = [
      'step-back', 'step-forward', 'step-back-10', 'step-forward-10', 'home', 'end',
      'prev-flag', 'next-flag', 'prev-event', 'next-event', 'focus-frame-field', 'play-pause',
      'zoom-in', 'zoom-out', 'zoom-fit', 'tool-nose', 'tool-centroid', 'cancel',
      'nudge-left', 'nudge-right', 'nudge-up', 'nudge-down', 'mark-invalid',
      'paint-not-visible', 'mark-escape-box', 'add-event', 'delete-event',
      'edge-start', 'edge-end', 'retime-back', 'retime-forward', 'relabel-event', 'trial-start-here',
    ];
    for (const action of expected) expect(actions.has(action), action).toBe(true);
    // in any one context a key with a given shift state resolves to at most one action
    for (const ctx of [idle, armed, edge]) {
      for (const shift of [false, true]) {
        const seen = new Map<string, ReviewAction>();
        for (const binding of REVIEW_KEYS) {
          for (const key of binding.keys) {
            const action = resolveKey(press(key, shift), ctx);
            if (action === null) continue;
            const before = seen.get(key);
            expect(before === undefined || before === action, `${key} shift=${shift}`).toBe(true);
            seen.set(key, action);
          }
        }
      }
    }
  });

  it('prints one legend row per binding with a description', () => {
    const legend = keyLegend();
    expect(legend).toHaveLength(REVIEW_KEYS.length);
    for (const row of legend) {
      expect(row.keys.length).toBeGreaterThan(0);
      expect(row.description.length).toBeGreaterThan(8);
    }
  });
});

describe('resolveKey', () => {
  it('steps frames with the arrows, ten with Shift, unless a point tool is armed or an edge is selected', () => {
    expect(resolveKey(press('ArrowLeft'), idle)).toBe('step-back');
    expect(resolveKey(press('ArrowRight'), idle)).toBe('step-forward');
    expect(resolveKey(press('ArrowLeft', true), idle)).toBe('step-back-10');
    expect(resolveKey(press('ArrowRight', true), idle)).toBe('step-forward-10');
    expect(resolveKey(press('ArrowLeft'), armed)).toBe('nudge-left');
    expect(resolveKey(press('ArrowUp', true), armed)).toBe('nudge-up');
    expect(resolveKey(press('ArrowRight', true), edge)).toBe('retime-forward');
    expect(resolveKey(press('ArrowLeft', true), edge)).toBe('retime-back');
    expect(resolveKey(press('ArrowLeft'), edge)).toBe('step-back'); // plain arrows still step
    expect(resolveKey(press('ArrowLeft', true), { pointTool: true, edgeSelected: true })).toBe('nudge-left');
  });

  it('maps the letters, brackets and Space, case-insensitively, with Shift + E going backwards', () => {
    expect(resolveKey(press('e'), idle)).toBe('next-event');
    expect(resolveKey(press('E', true), idle)).toBe('prev-event');
    // The brackets walk the review queue; Shift with them walks the finer
    // frame-level runs. `{` and `}` are what Shift produces on a US layout.
    expect(resolveKey(press('['), idle)).toBe('prev-flagged-event');
    expect(resolveKey(press(']'), idle)).toBe('next-flagged-event');
    expect(resolveKey(press('{', true), idle)).toBe('prev-flag');
    expect(resolveKey(press('}', true), idle)).toBe('next-flag');
    expect(resolveKey(press('[', true), idle)).toBe('prev-flag');
    expect(resolveKey(press(']', true), idle)).toBe('next-flag');
    expect(resolveKey(press(' '), idle)).toBe('play-pause');
    expect(resolveKey(press('f'), idle)).toBe('focus-frame-field');
    expect(resolveKey(press('N'), idle)).toBe('tool-nose');
    expect(resolveKey(press('c'), idle)).toBe('tool-centroid');
    expect(resolveKey(press('x'), armed)).toBe('mark-invalid');
    expect(resolveKey(press('x'), idle)).toBeNull();
    expect(resolveKey(press('v'), idle)).toBe('paint-not-visible');
    expect(resolveKey(press('b'), idle)).toBe('mark-escape-box');
    expect(resolveKey(press('a'), idle)).toBe('add-event');
    expect(resolveKey(press('Delete'), idle)).toBe('delete-event');
    expect(resolveKey(press('Backspace'), idle)).toBe('delete-event');
    expect(resolveKey(press('s'), idle)).toBe('edge-start');
    expect(resolveKey(press('d'), idle)).toBe('edge-end');
    expect(resolveKey(press('t'), idle)).toBe('trial-start-here');
    expect(resolveKey(press('h'), idle)).toBe('relabel-event');
    expect(resolveKey(press('Escape'), armed)).toBe('cancel');
    expect(resolveKey(press('Home'), armed)).toBe('home');
    expect(resolveKey(press('+', true), idle)).toBe('zoom-in');
    expect(resolveKey(press('='), idle)).toBe('zoom-in');
    expect(resolveKey(press('-'), idle)).toBe('zoom-out');
    expect(resolveKey(press('0'), idle)).toBe('zoom-fit');
  });

  it('leaves modifier chords to the browser and the frame view', () => {
    expect(resolveKey(press('ArrowLeft', false, { altKey: true }), idle)).toBeNull();
    expect(resolveKey(press('c', false, { metaKey: true }), idle)).toBeNull();
    expect(resolveKey(press('c', false, { ctrlKey: true }), idle)).toBeNull();
    expect(resolveKey(press('q'), idle)).toBeNull();
  });
});
