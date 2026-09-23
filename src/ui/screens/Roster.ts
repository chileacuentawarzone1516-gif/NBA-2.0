import { ATTRIBUTE_GROUPS } from '../../data/attributes';
import { t } from '../../data/i18n';
import { PLAYERS, getPlayer, playerOverall, type PlayerDef } from '../../data/players';
import { TEAMS, colorToCss } from '../../data/teams';
import { ratingBadge, screen, statBar } from '../components';
import { h } from '../dom';
import type { UiContext } from './context';

/** Attribute sheet grouped by category (shared by roster and My Player). */
export function attributeSheet(player: Pick<PlayerDef, 'attributes'>): HTMLElement {
  return h(
    'div',
    { class: 'attr-sheet' },
    ...Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) =>
      h(
        'div',
        { class: 'attr-group' },
        h('h3', { class: 'attr-group-title', text: t(`attrGroup.${group as keyof typeof ATTRIBUTE_GROUPS}`) }),
        ...keys.map((key) => statBar(t(`attr.${key}`), player.attributes[key])),
      ),
    ),
  );
}

function playerCard(player: PlayerDef, onSelect: (p: PlayerDef) => void, selected: boolean): HTMLElement {
  return h(
    'button',
    { class: `player-card${selected ? ' on' : ''}`, attrs: { type: 'button', 'aria-pressed': String(selected) }, on: { click: () => onSelect(player) } },
    ratingBadge(playerOverall(player)),
    h(
      'span',
      { class: 'player-card-info' },
      h('span', { class: 'player-card-name', text: `${player.firstName} ${player.lastName}` }),
      h('span', { class: 'player-card-meta', text: `#${player.number} · ${player.position} · ${t(`archetype.${player.archetype}`)} · ${player.height.toFixed(2)} m` }),
    ),
  );
}

export function createPlayersScreen(ctx: UiContext): HTMLElement {
  const list = h('div', { class: 'player-list' });
  const detail = h('div', { class: 'player-detail', attrs: { 'aria-live': 'polite' } });
  let selected: PlayerDef = PLAYERS.values().next().value as PlayerDef;
  const render = (): void => {
    list.replaceChildren(
      ...TEAMS.map((team) =>
        h(
          'div',
          { class: 'team-block', style: { '--team': colorToCss(team.colors.primary) } },
          h('h2', { class: 'team-block-title', text: `${team.city} ${team.name}` }),
          ...team.roster.map((id) => playerCard(getPlayer(id), (p) => ((selected = p), render()), selected.id === id)),
        ),
      ),
    );
    detail.replaceChildren(
      h('h2', { class: 'detail-title', text: `${selected.firstName} ${selected.lastName}` }),
      h('p', { class: 'muted', text: `${t('players.overall')} ${playerOverall(selected)} · ${t(`archetype.${selected.archetype}`)} · ${t('players.height')} ${selected.height.toFixed(2)} m` }),
      attributeSheet(selected),
    );
  };
  render();
  return screen(t('players.title'), () => ctx.go.menu(), t('menu.back'), h('div', { class: 'split' }, list, detail));
}

export function createTeamsScreen(ctx: UiContext): HTMLElement {
  return screen(
    t('teams.title'),
    () => ctx.go.menu(),
    t('menu.back'),
    h(
      'div',
      { class: 'team-grid' },
      ...TEAMS.map((team) => {
        const roster = team.roster.map(getPlayer);
        const overall = Math.round(roster.slice(0, 3).reduce((s, p) => s + playerOverall(p), 0) / 3);
        return h(
          'article',
          { class: 'team-card', style: { '--team': colorToCss(team.colors.primary), '--team2': colorToCss(team.colors.secondary) } },
          h('div', { class: 'team-card-head' }, h('span', { class: 'team-card-short', text: team.short }), ratingBadge(overall)),
          h('h2', { class: 'team-card-name', text: `${team.city} ${team.name}` }),
          h('p', { class: 'muted small', text: t('teams.arena', { name: team.arena.name }) }),
          h('ul', { class: 'team-roster' }, ...roster.map((p) => h('li', { text: `#${p.number} ${p.firstName} ${p.lastName} · ${p.position}` }))),
        );
      }),
    ),
  );
}
