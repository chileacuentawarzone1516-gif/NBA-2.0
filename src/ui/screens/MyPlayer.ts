import { ARCHETYPE_IDS, ARCHETYPES, archetypeCap, type ArchetypeId } from '../../data/archetypes';
import { ATTRIBUTE_GROUPS, computeOverall } from '../../data/attributes';
import { t } from '../../data/i18n';
import { MAX_EQUIPPED_SKILLS, SKILL_IDS, SKILLS } from '../../data/skills';
import { canUpgrade, createMyPlayer, isSkillUnlocked, upgradeAttribute, upgradeCost, xpToNext } from '../../progression/progression';
import { button, ratingBadge, screen } from '../components';
import { h, sanitizeName } from '../dom';
import type { UiContext } from './context';

function createForm(ctx: UiContext, rerender: () => void): HTMLElement {
  let archetype: ArchetypeId = 'playmaker';
  const nameInput = h('input', {
    class: 'text-input',
    attrs: { type: 'text', maxlength: 16, autocomplete: 'off', placeholder: t('myPlayer.namePlaceholder'), 'aria-label': t('myPlayer.name') },
  });
  const cards = h('div', { class: 'archetype-grid', attrs: { role: 'radiogroup', 'aria-label': t('myPlayer.archetype') } });
  const renderCards = (): void => {
    cards.replaceChildren(
      ...ARCHETYPE_IDS.map((id) => {
        const def = ARCHETYPES[id];
        return h(
          'button',
          { class: `archetype-card${id === archetype ? ' on' : ''}`, attrs: { type: 'button', role: 'radio', 'aria-checked': String(id === archetype) }, on: { click: () => ((archetype = id), renderCards()) } },
          h('span', { class: 'archetype-name', text: t(`archetype.${id}`) }),
          h('span', { class: 'archetype-meta', text: `${def.positions.join('/')} · ${def.body.height.toFixed(2)} m` }),
        );
      }),
    );
  };
  renderCards();
  const create = button(t('myPlayer.create'), () => {
    const name = sanitizeName(nameInput.value) || 'Rookie';
    ctx.save.update((d) => void (d.myPlayer = createMyPlayer(name, archetype)));
    rerender();
  }, 'primary', 'btn-large');
  return h(
    'div',
    { class: 'create-form' },
    h('label', { class: 'field-label', text: t('myPlayer.name') }),
    nameInput,
    h('div', { class: 'field-label', text: t('myPlayer.archetype') }),
    cards,
    create,
  );
}

function profile(ctx: UiContext, rerender: () => void): HTMLElement {
  const p = ctx.save.get().myPlayer!;
  const career = ctx.save.get().career;
  const overall = computeOverall(p.attributes, p.position);
  const next = xpToNext(p.level);
  const xpBar = h('div', { class: 'xp-bar', attrs: { role: 'progressbar', 'aria-valuenow': p.xp, 'aria-valuemax': next, 'aria-valuemin': 0 } }, h('span', { class: 'xp-fill', style: { width: `${Math.min(100, (p.xp / next) * 100)}%` } }));

  const attrs = h(
    'div',
    { class: 'attr-sheet' },
    ...Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) =>
      h(
        'div',
        { class: 'attr-group' },
        h('h3', { class: 'attr-group-title', text: t(`attrGroup.${group as keyof typeof ATTRIBUTE_GROUPS}`) }),
        ...keys.map((key) => {
          const value = p.attributes[key];
          const cap = archetypeCap(p.archetype, key);
          const maxed = value >= cap;
          const upgrade = h('button', {
            class: 'btn-mini',
            text: maxed ? t('myPlayer.maxed') : `+1 (${upgradeCost(p.archetype, key)})`,
            attrs: { type: 'button', disabled: !canUpgrade(p, key), 'aria-label': `${t('myPlayer.upgrade')} ${t(`attr.${key}`)}` },
            on: {
              click: () => {
                ctx.save.update((d) => {
                  if (d.myPlayer) d.myPlayer = upgradeAttribute(d.myPlayer, key);
                });
                rerender();
              },
            },
          });
          return h(
            'div',
            { class: 'stat-row upgradable' },
            h('span', { class: 'stat-label', text: t(`attr.${key}`) }),
            h('span', { class: 'stat-track' }, h('span', { class: 'stat-cap', style: { width: `${(cap / 99) * 100}%` } }), h('span', { class: 'stat-fill good', style: { width: `${(value / 99) * 100}%` } })),
            h('span', { class: 'stat-value', text: String(value) }),
            upgrade,
          );
        }),
      ),
    ),
  );

  const skills = h(
    'div',
    { class: 'skill-list' },
    ...SKILL_IDS.map((id) => {
      const unlocked = isSkillUnlocked(p, id);
      const equipped = p.equippedSkills.includes(id);
      const full = p.equippedSkills.length >= MAX_EQUIPPED_SKILLS;
      return h(
        'div',
        { class: `skill-card${equipped ? ' on' : ''}${unlocked ? '' : ' locked'}` },
        h('span', { class: 'skill-name', text: t(`skill.${id}`) }),
        h('span', { class: 'skill-desc', text: t(`skill.${id}.desc`) }),
        unlocked
          ? h('button', {
              class: 'btn-mini',
              text: equipped ? t('myPlayer.unequip') : t('myPlayer.equip'),
              attrs: { type: 'button', disabled: !equipped && full },
              on: {
                click: () => {
                  ctx.save.update((d) => {
                    const mp = d.myPlayer;
                    if (!mp) return;
                    mp.equippedSkills = equipped ? mp.equippedSkills.filter((s) => s !== id) : [...mp.equippedSkills, id].slice(0, MAX_EQUIPPED_SKILLS);
                  });
                  rerender();
                },
              },
            })
          : h('span', { class: 'skill-lock', text: t('myPlayer.locked', { level: SKILLS[id].unlockLevel }) }),
      );
    }),
  );

  const reset = button(t('myPlayer.reset'), () => {
    if (!window.confirm(t('myPlayer.resetConfirm'))) return;
    ctx.save.update((d) => {
      d.myPlayer = null;
      d.career = { games: 0, wins: 0, points: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0 };
      d.lastSetup.useMyPlayer = false;
    });
    rerender();
  }, 'ghost');

  return h(
    'div',
    { class: 'profile' },
    h(
      'div',
      { class: 'profile-head' },
      ratingBadge(overall),
      h(
        'div',
        { class: 'profile-id' },
        h('h2', { class: 'detail-title', text: p.name }),
        h('p', { class: 'muted', text: `${t(`archetype.${p.archetype}`)} · ${p.position} · #${p.number} · ${t('menu.level', { level: p.level })}` }),
        xpBar,
        h('p', { class: 'muted small', text: t('myPlayer.xp', { xp: p.xp, next }) }),
      ),
      h('div', { class: 'points-pill', text: t('myPlayer.points', { points: p.upgradePoints }) }),
    ),
    h('p', { class: 'muted small', text: t('myPlayer.stats', { games: career.games, wins: career.wins, points: career.points }) }),
    h('div', { class: 'split' }, attrs, h('div', {}, h('h3', { class: 'attr-group-title', text: t('myPlayer.skills', { equipped: p.equippedSkills.length, max: MAX_EQUIPPED_SKILLS }) }), skills)),
    reset,
  );
}

export function createMyPlayerScreen(ctx: UiContext): HTMLElement {
  const body = h('div', { class: 'my-player' });
  const rerender = (): void => {
    body.replaceChildren(ctx.save.get().myPlayer ? profile(ctx, rerender) : createForm(ctx, rerender));
  };
  rerender();
  return screen(t('myPlayer.title'), () => ctx.go.menu(), t('menu.back'), body);
}
