import { h } from './dom';

/** Reusable, accessible form/menu components. All are keyboard operable with visible focus. */

let idCounter = 0;
const nextId = (prefix: string): string => `${prefix}-${++idCounter}`;

export function button(label: string, onClick: () => void, variant: 'primary' | 'default' | 'ghost' = 'default', extraClass = ''): HTMLButtonElement {
  const cls = ['btn', variant === 'primary' ? 'btn-primary' : variant === 'ghost' ? 'btn-ghost' : '', extraClass].filter(Boolean).join(' ');
  return h('button', { class: cls, text: label, attrs: { type: 'button' }, on: { click: onClick } });
}

export function screen(title: string, onBack: (() => void) | null, backLabel: string, ...content: HTMLElement[]): HTMLElement {
  const header = h(
    'header',
    { class: 'screen-header' },
    onBack ? h('button', { class: 'btn-icon back', attrs: { type: 'button', 'aria-label': backLabel }, on: { click: onBack } }, h('span', { class: 'chevron', attrs: { 'aria-hidden': 'true' } })) : null,
    h('h1', { class: 'screen-title', text: title }),
  );
  return h('section', { class: 'screen', attrs: { 'aria-label': title } }, header, h('div', { class: 'screen-body' }, ...content));
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

/** Radio-group styled as segmented buttons (arrow keys move the selection). */
export function segmented<T extends string>(label: string, options: ReadonlyArray<SegmentOption<T>>, value: T, onChange: (value: T) => void): HTMLElement {
  const group = h('div', { class: 'segmented', attrs: { role: 'radiogroup', 'aria-label': label } });
  const buttons: HTMLButtonElement[] = [];
  const select = (index: number, focus: boolean): void => {
    buttons.forEach((b, i) => {
      const on = i === index;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('on', on);
    });
    if (focus) buttons[index]?.focus();
    onChange(options[index]!.value);
  };
  options.forEach((opt, index) => {
    const b = h(
      'button',
      { class: 'seg', attrs: { type: 'button', role: 'radio', 'aria-checked': String(opt.value === value), tabindex: opt.value === value ? 0 : -1 } },
      h('span', { class: 'seg-label', text: opt.label }),
      opt.detail ? h('span', { class: 'seg-detail', text: opt.detail }) : null,
    );
    if (opt.value === value) b.classList.add('on');
    b.addEventListener('click', () => select(index, false));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        select((index + 1) % options.length, true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        select((index - 1 + options.length) % options.length, true);
      }
    });
    buttons.push(b);
    group.append(b);
  });
  return field(label, group, false);
}

export function toggle(label: string, checked: boolean, onChange: (checked: boolean) => void): HTMLElement {
  const id = nextId('tg');
  const input = h('input', { id, class: 'toggle-input', attrs: { type: 'checkbox', role: 'switch' } });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle', attrs: { for: id } }, h('span', { class: 'toggle-text', text: label }), input, h('span', { class: 'toggle-track', attrs: { 'aria-hidden': 'true' } }));
}

export function slider(label: string, value: number, min: number, max: number, step: number, format: (v: number) => string, onChange: (value: number) => void): HTMLElement {
  const id = nextId('sl');
  const output = h('output', { class: 'slider-value', text: format(value), attrs: { for: id } });
  const input = h('input', { id, class: 'slider', attrs: { type: 'range', min, max, step } });
  input.value = String(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    output.textContent = format(v);
    onChange(v);
  });
  return h('div', { class: 'field' }, h('label', { class: 'field-label', attrs: { for: id } }, label, output), input);
}

export function field(label: string, control: HTMLElement, asLabel = true): HTMLElement {
  return h('div', { class: 'field' }, asLabel ? h('label', { class: 'field-label', text: label }) : h('div', { class: 'field-label', text: label }), control);
}

export function statBar(label: string, value: number, max = 99): HTMLElement {
  const pct = Math.round((value / max) * 100);
  const tier = value >= 85 ? 'elite' : value >= 70 ? 'good' : value >= 55 ? 'avg' : 'low';
  return h(
    'div',
    { class: 'stat-row', attrs: { role: 'meter', 'aria-label': label, 'aria-valuenow': value, 'aria-valuemin': 25, 'aria-valuemax': max } },
    h('span', { class: 'stat-label', text: label }),
    h('span', { class: 'stat-track' }, h('span', { class: `stat-fill ${tier}`, style: { width: `${pct}%` } })),
    h('span', { class: `stat-value ${tier}`, text: String(value) }),
  );
}

export function ratingBadge(value: number): HTMLElement {
  const tier = value >= 85 ? 'elite' : value >= 75 ? 'good' : value >= 65 ? 'avg' : 'low';
  return h('span', { class: `rating-badge ${tier}`, text: String(value) });
}
