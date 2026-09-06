/**
 * Small DOM helpers. No framework (D3): the correction UI is canvas-bound,
 * where a framework adds little, so the DOM layer is a dozen lines of typed
 * element construction and nothing else.
 *
 * Nothing here ever assigns `innerHTML`, so no string in this app can become
 * markup.
 */

type Attrs = Record<string, string | number | boolean | null | undefined>;

export interface ElOptions {
  class?: string;
  text?: string;
  id?: string;
  attrs?: Attrs;
}

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElOptions = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.class !== undefined) node.className = options.class;
  if (options.id !== undefined) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.attrs) setAttrs(node, options.attrs);
  append(node, children);
  return node;
}

export function setAttrs(node: Element, attrs: Attrs): void {
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) node.removeAttribute(name);
    else node.setAttribute(name, value === true ? '' : String(value));
  }
}

export function append(node: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
}

export function replaceChildren(node: Element, children: Child[]): void {
  node.replaceChildren();
  append(node, children);
}

/** A native disclosure: keyboard-operable and screen-reader-announced without any script. */
export function disclosure(summaryText: string, children: Child[], open = false): HTMLDetailsElement {
  const details = el('details', { class: 'disclosure', attrs: { open } });
  details.append(el('summary', { text: summaryText }));
  append(details, children);
  return details;
}

/** A labelled control. The label always wraps or points at the input — never a bare placeholder. */
export function field(
  labelText: string,
  control: HTMLElement,
  options: { hint?: string; class?: string } = {},
): HTMLElement {
  const id = control.id || uniqueId('field');
  control.id = id;
  const label = el('label', { text: labelText, attrs: { for: id } });
  const hint = options.hint === undefined ? null : el('span', { class: 'hint', text: options.hint });
  if (hint) {
    hint.id = `${id}-hint`;
    control.setAttribute('aria-describedby', hint.id);
  }
  return el('div', { class: options.class ?? 'field' }, [label, control, hint]);
}

let idCounter = 0;
export function uniqueId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

export function button(
  text: string,
  onClick: () => void,
  options: ElOptions = {},
): HTMLButtonElement {
  const node = el('button', { ...options, text });
  node.type = 'button';
  node.addEventListener('click', onClick);
  return node;
}

/** `1:23` / `3:05`, the way a video player writes a duration. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
