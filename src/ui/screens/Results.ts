import type { MatchResult } from '../../app/GameSession';
import { t } from '../../data/i18n';
import type { SkillId } from '../../data/skills';
import type { TeamDef } from '../../data/teams';
import { colorToCss } from '../../data/teams';
import { button } from '../components';
import { h } from '../dom';

export interface ProgressSummary {
  xp: number;
  level: number;
  levelsGained: number;
  newSkills: SkillId[];
  xpInLevel: number;
  xpToNext: number;
}

export function createResultsScreen(
  result: MatchResult,
  teams: readonly [TeamDef, TeamDef],
  progress: ProgressSummary | null,
  onContinue: () => void,
  onRematch: () => void,
): HTMLElement {
  const won = result.winner === result.humanTeam;
  const headers = ['results.player', 'stat.pts', 'stat.reb', 'stat.ast', 'stat.stl', 'stat.blk', 'stat.tov', 'stat.fg', 'stat.3p'] as const;
  const rows = [...result.players].sort((a, b) => a.team - b.team || b.stats.points - a.stats.points);
  const table = h(
    'table',
    { class: 'box-score' },
    h('caption', { text: t('results.boxScore') }),
    h('thead', {}, h('tr', {}, ...headers.map((key) => h('th', { text: t(key), attrs: { scope: 'col' } })))),
    h(
      'tbody',
      {},
      ...rows.map((p) =>
        h(
          'tr',
          { style: { '--team': colorToCss(teams[p.team].colors.primary) } },
          h('th', { attrs: { scope: 'row' }, text: `${teams[p.team].short} · ${p.name}` }),
          h('td', { text: String(p.stats.points) }),
          h('td', { text: String(p.stats.oreb + p.stats.dreb) }),
          h('td', { text: String(p.stats.assists) }),
          h('td', { text: String(p.stats.steals) }),
          h('td', { text: String(p.stats.blocks) }),
          h('td', { text: String(p.stats.turnovers) }),
          h('td', { text: `${p.stats.fgm}/${p.stats.fga}` }),
          h('td', { text: `${p.stats.tpm}/${p.stats.tpa}` }),
        ),
      ),
    ),
  );

  const progressBlock = progress
    ? h(
        'div',
        { class: 'progress-block' },
        h('p', { class: 'xp-gain', text: t('results.xp', { xp: progress.xp }) }),
        h('div', { class: 'xp-bar' }, h('span', { class: 'xp-fill', style: { width: `${Math.min(100, (progress.xpInLevel / progress.xpToNext) * 100)}%` } })),
        progress.levelsGained > 0 ? h('p', { class: 'level-up', text: t('results.levelUp', { level: progress.level }) }) : null,
        ...progress.newSkills.map((s) => h('p', { class: 'new-skill', text: t('results.newSkill', { skill: t(`skill.${s}`) }) })),
      )
    : null;

  return h(
    'section',
    { class: `screen results ${won ? 'win' : 'loss'}`, attrs: { 'aria-label': t(won ? 'results.win' : 'results.loss') } },
    h('h1', { class: 'result-banner', text: t(won ? 'results.win' : 'results.loss') }),
    h(
      'div',
      { class: 'final-score', attrs: { 'aria-label': t('results.final') } },
      h('span', { class: 'fs-team', style: { '--team': colorToCss(teams[0].colors.primary) }, text: teams[0].short }),
      h('span', { class: 'fs-score', text: `${result.score[0]} – ${result.score[1]}` }),
      h('span', { class: 'fs-team', style: { '--team': colorToCss(teams[1].colors.primary) }, text: teams[1].short }),
    ),
    progressBlock,
    h('div', { class: 'table-wrap' }, table),
    h('div', { class: 'btn-row' }, button(t('results.rematch'), onRematch), button(t('results.continue'), onContinue, 'primary')),
  );
}
