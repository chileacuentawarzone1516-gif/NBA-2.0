import { BRAND } from '../../data/brand';
import { t } from '../../data/i18n';
import { h } from '../dom';
import type { UiContext } from './context';

export function createMainMenu(ctx: UiContext): HTMLElement {
  const my = ctx.save.get().myPlayer;
  const item = (label: string, detail: string, onClick: () => void, primary = false): HTMLButtonElement =>
    h(
      'button',
      { class: `menu-item${primary ? ' primary' : ''}`, attrs: { type: 'button' }, on: { click: onClick } },
      h('span', { class: 'menu-item-label', text: label }),
      detail ? h('span', { class: 'menu-item-detail', text: detail }) : null,
    );
  return h(
    'section',
    { class: 'screen main-menu', attrs: { 'aria-label': BRAND.name } },
    h(
      'div',
      { class: 'brand' },
      h('div', { class: 'brand-mark', attrs: { 'aria-hidden': 'true' } }),
      h('h1', { class: 'brand-name', text: BRAND.name }),
      h('p', { class: 'brand-tagline', text: t('app.tagline') }),
    ),
    h(
      'nav',
      { class: 'menu-grid', attrs: { 'aria-label': 'main' } },
      item(t('menu.play'), `${t('mode.oneOnOne')} · ${t('mode.threeOnThree')}`, () => ctx.go.setup(), true),
      item(t('menu.practice'), t('mode.practice.desc'), () => ctx.startPractice()),
      item(t('menu.myPlayer'), my ? `${my.name} · ${t('menu.level', { level: my.level })}` : t('myPlayer.create'), () => ctx.go.myPlayer()),
      item(t('menu.players'), '', () => ctx.go.players()),
      item(t('menu.teams'), '', () => ctx.go.teams()),
      item(t('menu.settings'), '', () => ctx.go.settings()),
    ),
    h('p', { class: 'version', text: `v${BRAND.version}` }),
  );
}
