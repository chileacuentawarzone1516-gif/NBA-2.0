import { DIFFICULTY_IDS } from '../../data/difficulty';
import { t } from '../../data/i18n';
import type { ModeId } from '../../data/modes';
import { TEAMS, colorToCss, type TeamDef } from '../../data/teams';
import { button, segmented, toggle } from '../components';
import { h } from '../dom';
import type { UiContext } from './context';

function teamPicker(label: string, selected: string, disabled: string, onPick: (id: string) => void): HTMLElement {
  const list = h('div', { class: 'team-picker', attrs: { role: 'radiogroup', 'aria-label': label } });
  const render = (current: string): void => {
    list.replaceChildren(
      ...TEAMS.map((team: TeamDef) =>
        h(
          'button',
          {
            class: `team-chip${team.id === current ? ' on' : ''}`,
            attrs: { type: 'button', role: 'radio', 'aria-checked': String(team.id === current), disabled: team.id === disabled, 'aria-label': `${team.city} ${team.name}` },
            style: { '--team': colorToCss(team.colors.primary), '--team2': colorToCss(team.colors.secondary) },
            on: {
              click: () => {
                onPick(team.id);
                render(team.id);
              },
            },
          },
          h('span', { class: 'team-chip-short', text: team.short }),
          h('span', { class: 'team-chip-name', text: team.name }),
        ),
      ),
    );
  };
  render(selected);
  return h('div', { class: 'field' }, h('div', { class: 'field-label', text: label }), list);
}

export function createPlaySetup(ctx: UiContext, initialMode?: ModeId): HTMLElement {
  const save = ctx.save;
  if (initialMode && initialMode !== 'practice') save.update((d) => void (d.lastSetup.mode = initialMode));
  const setup = save.get().lastSetup;
  const hasMyPlayer = save.get().myPlayer !== null;
  const body = h('div', { class: 'setup-grid' });

  const rebuild = (): void => {
    const s = save.get().lastSetup;
    body.replaceChildren(
      segmented(
        t('setup.mode'),
        [
          { value: 'oneOnOne' as const, label: t('mode.oneOnOne'), detail: t('mode.oneOnOne.desc') },
          { value: 'threeOnThree' as const, label: t('mode.threeOnThree'), detail: t('mode.threeOnThree.desc') },
        ],
        s.mode === 'threeOnThree' ? 'threeOnThree' : 'oneOnOne',
        (mode) => save.update((d) => void (d.lastSetup.mode = mode)),
      ),
      teamPicker(t('setup.yourTeam'), s.homeTeamId, s.awayTeamId, (id) => {
        save.update((d) => void (d.lastSetup.homeTeamId = id));
        rebuild();
      }),
      teamPicker(t('setup.opponent'), s.awayTeamId, s.homeTeamId, (id) => {
        save.update((d) => void (d.lastSetup.awayTeamId = id));
        rebuild();
      }),
      segmented(
        t('setup.difficulty'),
        DIFFICULTY_IDS.map((id) => ({ value: id, label: t(`difficulty.${id}`) })),
        s.difficulty,
        (difficulty) => save.update((d) => void (d.lastSetup.difficulty = difficulty)),
      ),
      hasMyPlayer ? toggle(t('setup.useMyPlayer'), s.useMyPlayer, (on) => save.update((d) => void (d.lastSetup.useMyPlayer = on))) : h('span'),
    );
  };
  rebuild();
  if (setup.homeTeamId === setup.awayTeamId) {
    save.update((d) => void (d.lastSetup.awayTeamId = TEAMS.find((x) => x.id !== d.lastSetup.homeTeamId)!.id));
    rebuild();
  }

  const start = button(t('setup.start'), () => ctx.startMatch(), 'primary', 'btn-large');
  const header = h(
    'header',
    { class: 'screen-header' },
    h('button', { class: 'btn-icon back', attrs: { type: 'button', 'aria-label': t('menu.back') }, on: { click: () => ctx.go.menu() } }, h('span', { class: 'chevron', attrs: { 'aria-hidden': 'true' } })),
    h('h1', { class: 'screen-title', text: t('setup.title') }),
  );
  return h('section', { class: 'screen', attrs: { 'aria-label': t('setup.title') } }, header, h('div', { class: 'screen-body' }, body), h('footer', { class: 'screen-footer' }, start));
}
