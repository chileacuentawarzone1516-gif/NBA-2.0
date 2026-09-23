/**
 * Tiny DOM builder. Text is always assigned via textContent (never innerHTML), so
 * player-provided strings (e.g. a custom player name) cannot inject markup.
 */
type Child = Node | string | number | null | undefined | false;

export interface ElementProps {
  class?: string;
  id?: string;
  text?: string;
  attrs?: Record<string, string | number | boolean | undefined>;
  style?: Partial<CSSStyleDeclaration> & Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: ElementProps = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) {
    for (const [key, value] of Object.entries(props.attrs)) {
      if (value === undefined || value === false) continue;
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  if (props.style) Object.assign(el.style, props.style);
  if (props.on) {
    for (const [type, handler] of Object.entries(props.on)) {
      if (handler) el.addEventListener(type, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(typeof child === 'number' ? String(child) : child);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Sanitizes a user-entered display name: trims, collapses whitespace, strips control chars, limits length. */
export function sanitizeName(raw: string, maxLength = 16): string {
  return raw
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}
