/**
 * The keyboard map of the Review step (D24, D37), as data: the same table
 * drives the key handler and the on-screen legend, so what the legend says is
 * what the keys do. Pure, tested in Node.
 *
 * Conflicts are resolved by context, not by modifiers alone: while a point
 * tool is armed the arrow keys nudge the point instead of stepping frames,
 * and while an event edge is selected Shift with ← / → retimes that edge
 * instead of stepping ten frames. Alt with the arrows is never consumed here;
 * the frame view uses it to pan.
 */

export type ReviewAction =
  | 'step-back'
  | 'step-forward'
  | 'step-back-10'
  | 'step-forward-10'
  | 'home'
  | 'end'
  | 'prev-flag'
  | 'next-flag'
  | 'prev-event'
  | 'next-event'
  | 'focus-frame-field'
  | 'play-pause'
  | 'zoom-in'
  | 'zoom-out'
  | 'zoom-fit'
  | 'tool-nose'
  | 'tool-centroid'
  | 'cancel'
  | 'nudge-left'
  | 'nudge-right'
  | 'nudge-up'
  | 'nudge-down'
  | 'mark-invalid'
  | 'paint-not-visible'
  | 'mark-escape-box'
  | 'add-event'
  | 'delete-event'
  | 'edge-start'
  | 'edge-end'
  | 'retime-back'
  | 'retime-forward'
  | 'relabel-event'
  | 'trial-start-here';

/** When a binding applies. Bindings are tried in table order; the first that applies wins. */
export type KeyWhen = 'always' | 'point-tool' | 'no-point-tool' | 'edge-selected' | 'no-edge';

export interface KeyBinding {
  /** `KeyboardEvent.key` values, letters in lower case. */
  keys: readonly string[];
  shift: boolean;
  when: KeyWhen;
  action: ReviewAction;
  /** How the legend prints the keys. */
  legend: string;
  description: string;
}

export interface KeyContext {
  pointTool: boolean;
  edgeSelected: boolean;
}

export const REVIEW_KEYS: readonly KeyBinding[] = [
  // arrows: nudge while a point tool is armed, retime while an edge is selected, step otherwise
  { keys: ['arrowleft'], shift: false, when: 'point-tool', action: 'nudge-left', legend: '←', description: 'Nudge the armed point 1 px left' },
  { keys: ['arrowright'], shift: false, when: 'point-tool', action: 'nudge-right', legend: '→', description: 'Nudge the armed point 1 px right' },
  { keys: ['arrowup'], shift: false, when: 'point-tool', action: 'nudge-up', legend: '↑', description: 'Nudge the armed point 1 px up' },
  { keys: ['arrowdown'], shift: false, when: 'point-tool', action: 'nudge-down', legend: '↓', description: 'Nudge the armed point 1 px down' },
  { keys: ['arrowleft'], shift: true, when: 'point-tool', action: 'nudge-left', legend: 'Shift + ←', description: 'Nudge the armed point 10 px left' },
  { keys: ['arrowright'], shift: true, when: 'point-tool', action: 'nudge-right', legend: 'Shift + →', description: 'Nudge the armed point 10 px right' },
  { keys: ['arrowup'], shift: true, when: 'point-tool', action: 'nudge-up', legend: 'Shift + ↑', description: 'Nudge the armed point 10 px up' },
  { keys: ['arrowdown'], shift: true, when: 'point-tool', action: 'nudge-down', legend: 'Shift + ↓', description: 'Nudge the armed point 10 px down' },
  { keys: ['arrowleft'], shift: true, when: 'edge-selected', action: 'retime-back', legend: 'Shift + ←', description: 'Move the selected event edge one frame earlier' },
  { keys: ['arrowright'], shift: true, when: 'edge-selected', action: 'retime-forward', legend: 'Shift + →', description: 'Move the selected event edge one frame later' },
  { keys: ['arrowleft'], shift: false, when: 'no-point-tool', action: 'step-back', legend: '←', description: 'One frame back' },
  { keys: ['arrowright'], shift: false, when: 'no-point-tool', action: 'step-forward', legend: '→', description: 'One frame forward' },
  { keys: ['arrowleft'], shift: true, when: 'no-point-tool', action: 'step-back-10', legend: 'Shift + ←', description: 'Ten frames back' },
  { keys: ['arrowright'], shift: true, when: 'no-point-tool', action: 'step-forward-10', legend: 'Shift + →', description: 'Ten frames forward' },
  { keys: ['home'], shift: false, when: 'always', action: 'home', legend: 'Home', description: 'First frame' },
  { keys: ['end'], shift: false, when: 'always', action: 'end', legend: 'End', description: 'Last frame' },
  { keys: ['['], shift: false, when: 'always', action: 'prev-flag', legend: '[', description: 'Previous flagged run (a gap, an uncertain stretch or a review flag)' },
  { keys: [']'], shift: false, when: 'always', action: 'next-flag', legend: ']', description: 'Next flagged run' },
  { keys: ['e'], shift: false, when: 'always', action: 'next-event', legend: 'E', description: 'Next event' },
  { keys: ['e'], shift: true, when: 'always', action: 'prev-event', legend: 'Shift + E', description: 'Previous event' },
  { keys: ['f'], shift: false, when: 'always', action: 'focus-frame-field', legend: 'F', description: 'Go to the frame-number field' },
  { keys: [' '], shift: false, when: 'always', action: 'play-pause', legend: 'Space', description: 'Play or pause at normal speed' },
  { keys: ['+', '='], shift: false, when: 'always', action: 'zoom-in', legend: '+', description: 'Zoom the timeline in around the playhead' },
  { keys: ['+'], shift: true, when: 'always', action: 'zoom-in', legend: 'Shift + =', description: 'Zoom the timeline in around the playhead' },
  { keys: ['-'], shift: false, when: 'always', action: 'zoom-out', legend: '−', description: 'Zoom the timeline out' },
  { keys: ['0'], shift: false, when: 'always', action: 'zoom-fit', legend: '0', description: 'Show the whole clip' },
  { keys: ['n'], shift: false, when: 'always', action: 'tool-nose', legend: 'N', description: 'Arm the nose: click the frame or use the arrows to place it' },
  { keys: ['c'], shift: false, when: 'always', action: 'tool-centroid', legend: 'C', description: 'Arm the centroid: click the frame or use the arrows to place it' },
  { keys: ['x'], shift: false, when: 'point-tool', action: 'mark-invalid', legend: 'X', description: 'Mark the armed point invalid on this frame' },
  { keys: ['escape'], shift: false, when: 'always', action: 'cancel', legend: 'Esc', description: 'Disarm the point tool, cancel a range being marked, drop the selection' },
  { keys: ['v'], shift: false, when: 'always', action: 'paint-not-visible', legend: 'V', description: '"Animal not visible": press at the first frame, then again at the last' },
  { keys: ['b'], shift: false, when: 'always', action: 'mark-escape-box', legend: 'B', description: '"Animal in the escape box from here" to the end of the video' },
  { keys: ['a'], shift: false, when: 'always', action: 'add-event', legend: 'A', description: 'Add an investigation: press at the first frame, then again at the last' },
  { keys: ['delete', 'backspace'], shift: false, when: 'always', action: 'delete-event', legend: 'Delete', description: 'Delete the selected event' },
  { keys: ['h'], shift: false, when: 'always', action: 'relabel-event', legend: 'H', description: 'Change the hole of the selected event' },
  { keys: ['s'], shift: false, when: 'always', action: 'edge-start', legend: 'S', description: 'Select the start edge of the selected event, for Shift + ← / →' },
  { keys: ['d'], shift: false, when: 'always', action: 'edge-end', legend: 'D', description: 'Select the end edge of the selected event, for Shift + ← / →' },
  { keys: ['t'], shift: false, when: 'always', action: 'trial-start-here', legend: 'T', description: 'Set the trial start to this frame' },
];

function applies(when: KeyWhen, ctx: KeyContext): boolean {
  switch (when) {
    case 'always':
      return true;
    case 'point-tool':
      return ctx.pointTool;
    case 'no-point-tool':
      return !ctx.pointTool;
    case 'edge-selected':
      return ctx.edgeSelected && !ctx.pointTool;
    case 'no-edge':
      return !ctx.edgeSelected;
  }
}

export interface KeyLike {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

/** The action a key press means in this context, or null when it means nothing here. */
export function resolveKey(event: KeyLike, ctx: KeyContext): ReviewAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
  for (const binding of REVIEW_KEYS) {
    if (binding.shift !== event.shiftKey) continue;
    if (!binding.keys.includes(key)) continue;
    if (!applies(binding.when, ctx)) continue;
    return binding.action;
  }
  return null;
}

export interface LegendRow {
  keys: string;
  description: string;
  when: KeyWhen;
}

/** The bindings as the legend prints them, one row each. */
export function keyLegend(): LegendRow[] {
  return REVIEW_KEYS.map((b) => ({ keys: b.legend, description: b.description, when: b.when }));
}
