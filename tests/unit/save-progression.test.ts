import { describe, expect, it } from 'vitest';
import { archetypeCap } from '../../src/data/archetypes';
import { SKILLS } from '../../src/data/skills';
import { applyXp, canUpgrade, createMyPlayer, matchXp, MAX_MATCH_XP, myPlayerDef, upgradeAttribute, xpToNext } from '../../src/progression/progression';
import { migrate, SaveManager } from '../../src/save/SaveManager';
import { defaultSave, sanitizeSave, SAVE_VERSION } from '../../src/save/schema';
import { MemoryStorage } from '../../src/save/storage';
import { emptyStats } from '../../src/sim/types';

describe('save system', () => {
  it('migrates an unversioned (v0) save and keeps its settings', () => {
    const migrated = migrate({ settings: { quality: 'low', masterVolume: 0.3 } }) as Record<string, unknown>;
    expect(migrated.version).toBe(SAVE_VERSION);
    const save = sanitizeSave(migrated, defaultSave('high'));
    expect(save.settings.quality).toBe('low');
    expect(save.settings.masterVolume).toBe(0.3);
    expect(save.myPlayer).toBeNull();
  });

  it('sanitizes corrupted or tampered values instead of trusting them', () => {
    const save = sanitizeSave(
      {
        version: 1,
        settings: { quality: 'insane', masterVolume: 99, touch: { stickRadius: -5 }, language: 'xx' },
        myPlayer: { name: '<img src=x onerror=alert(1)>', archetype: 'playmaker', level: 9999, attributes: { speed: 500, threePoint: 'NaN' }, equippedSkills: ['deadeye', 'deadeye', 'hack', 'tireless', 'pickpocket', 'rimWall'] },
        career: { games: -4 },
        lastSetup: { homeTeamId: 'not-a-team', mode: 'fiveOnFive' },
      },
      defaultSave('medium'),
    );
    expect(save.settings.quality).toBe('medium');
    expect(save.settings.masterVolume).toBe(1);
    expect(save.settings.touch.stickRadius).toBe(40);
    expect(save.settings.language).toBe(defaultSave('medium').settings.language);
    expect(save.myPlayer?.name).not.toContain('<');
    expect(save.myPlayer?.level).toBe(40);
    expect(save.myPlayer?.attributes.speed).toBe(archetypeCap('playmaker', 'speed'));
    expect(save.myPlayer?.equippedSkills).toEqual(['deadeye', 'tireless', 'pickpocket']);
    expect(save.career.games).toBe(0);
    expect(save.lastSetup.homeTeamId).toBe(defaultSave('medium').lastSetup.homeTeamId);
    expect(save.lastSetup.mode).toBe('oneOnOne');
  });

  it('persists, reloads and falls back to the backup when the main save is corrupted', () => {
    const storage = new MemoryStorage();
    const first = new SaveManager(storage, 'high');
    first.update((d) => void (d.settings.crowdVolume = 0.25));
    first.update((d) => void (d.settings.sfxVolume = 0.5));
    storage.set('hoopline.save', '{ not json');
    const reloaded = new SaveManager(storage, 'high');
    // Backup holds the state before the last write.
    expect(reloaded.get().settings.crowdVolume).toBe(0.25);
  });
});

describe('progression', () => {
  it('awards bounded, stat-driven XP scaled by difficulty', () => {
    const stats = { ...emptyStats(), points: 20, oreb: 2, dreb: 5, assists: 4, steals: 2, blocks: 1, turnovers: 3 };
    const pro = matchXp(stats, true, 'pro', 'oneOnOne');
    const legend = matchXp(stats, true, 'legend', 'oneOnOne');
    expect(legend).toBeGreaterThan(pro);
    expect(matchXp(stats, false, 'pro', 'oneOnOne')).toBeLessThan(pro);
    expect(matchXp({ ...stats, points: 1000 }, true, 'legend', 'threeOnThree')).toBe(MAX_MATCH_XP);
    expect(matchXp(stats, true, 'pro', 'practice')).toBe(0);
  });

  it('levels up, grants points and unlocks skills at the right level', () => {
    const player = createMyPlayer('Test', 'sharpshooter');
    const needed = xpToNext(1) + xpToNext(2) + xpToNext(3);
    const { player: next, levelsGained, newSkills } = applyXp(player, needed);
    expect(levelsGained).toBe(3);
    expect(next.level).toBe(4);
    expect(next.upgradePoints).toBe(9);
    expect(newSkills).toEqual(expect.arrayContaining(['quickRelease', 'tireless', 'pickpocket']));
    expect(newSkills.every((s) => SKILLS[s].unlockLevel <= 4)).toBe(true);
  });

  it('upgrades respect cost, points and archetype caps', () => {
    let player = { ...createMyPlayer('Test', 'sharpshooter'), upgradePoints: 3 };
    expect(canUpgrade(player, 'threePoint')).toBe(true);
    player = upgradeAttribute(player, 'threePoint'); // focus attribute: 1 point
    expect(player.upgradePoints).toBe(2);
    player = upgradeAttribute(player, 'block'); // non-focus: 2 points
    expect(player.upgradePoints).toBe(0);
    expect(upgradeAttribute(player, 'speed')).toBe(player); // no points left
    const capped = { ...player, upgradePoints: 50, attributes: { ...player.attributes, threePoint: archetypeCap('sharpshooter', 'threePoint') } };
    expect(canUpgrade(capped, 'threePoint')).toBe(false);
  });

  it('converts the created player into a playable roster definition', () => {
    const def = myPlayerDef(createMyPlayer('Ana Ruiz', 'slasher'));
    expect(def.id).toBe('my-player');
    expect(def.firstName).toBe('Ana');
    expect(def.lastName).toBe('Ruiz');
    expect(def.archetype).toBe('slasher');
  });
});
