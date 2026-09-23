import { AudioEngine } from '../audio/AudioEngine';
import { createLogger } from '../core/logger';
import { hashSeed } from '../core/rng';
import { setLanguage } from '../data/i18n';
import { MODES } from '../data/modes';
import { QUALITY_PRESETS, detectDefaultQuality } from '../data/quality';
import { getTeam, type TeamDef } from '../data/teams';
import type { MatchConfig } from '../game/matchFactory';
import { applyXp, matchXp, myPlayerDef, xpToNext } from '../progression/progression';
import { MenuBackdrop } from '../render/MenuBackdrop';
import { Renderer } from '../render/Renderer';
import { SaveManager } from '../save/SaveManager';
import { createDefaultStorage } from '../save/storage';
import { h } from '../ui/dom';
import type { UiContext } from '../ui/screens/context';
import { createMainMenu } from '../ui/screens/MainMenu';
import { createMyPlayerScreen } from '../ui/screens/MyPlayer';
import { createPlaySetup } from '../ui/screens/PlaySetup';
import { createResultsScreen, type ProgressSummary } from '../ui/screens/Results';
import { createPlayersScreen, createTeamsScreen } from '../ui/screens/Roster';
import { createSettingsScreen } from '../ui/screens/SettingsScreen';
import { GameSession, type MatchResult } from './GameSession';

const log = createLogger('app');

/**
 * Application shell: screen flow (menu → setup → match → results → menu), persistence,
 * settings application and ownership of long-lived systems (renderer, audio).
 */
export class App {
  private readonly save: SaveManager;
  private readonly audio = new AudioEngine();
  private readonly renderer: Renderer;
  private readonly backdrop: MenuBackdrop;
  private readonly ui: HTMLElement;
  private readonly overlay: HTMLElement;
  private session: GameSession | null = null;
  private lastConfig: { config: MatchConfig; teams: readonly [TeamDef, TeamDef] } | null = null;
  private readonly ctx: UiContext;

  constructor(root: HTMLElement) {
    const nav = navigator as Navigator & { deviceMemory?: number };
    const mobile = window.matchMedia('(pointer: coarse)').matches;
    this.save = new SaveManager(createDefaultStorage(), detectDefaultQuality({ memoryGb: nav.deviceMemory, cores: nav.hardwareConcurrency, mobile }));
    const settings = this.save.get().settings;
    setLanguage(settings.language);
    this.audio.setVolumes({ master: settings.masterVolume, sfx: settings.sfxVolume, crowd: settings.crowdVolume });

    const canvas = root.querySelector<HTMLCanvasElement>('#scene');
    const ui = root.querySelector<HTMLElement>('#ui');
    const overlay = root.querySelector<HTMLElement>('#overlay');
    if (!canvas || !ui || !overlay) throw new Error('App root is missing #scene, #ui or #overlay');
    this.ui = ui;
    this.overlay = overlay;
    this.renderer = new Renderer(canvas, QUALITY_PRESETS[settings.quality]);
    this.backdrop = new MenuBackdrop(this.renderer);
    window.addEventListener('resize', () => this.renderer.resize());

    this.ctx = {
      save: this.save,
      go: {
        menu: () => this.show(createMainMenu(this.ctx)),
        setup: (mode) => this.show(createPlaySetup(this.ctx, mode)),
        players: () => this.show(createPlayersScreen(this.ctx)),
        teams: () => this.show(createTeamsScreen(this.ctx)),
        myPlayer: () => this.show(createMyPlayerScreen(this.ctx)),
        settings: () => this.show(createSettingsScreen(this.ctx)),
      },
      startMatch: () => this.startFromSetup(false),
      startPractice: () => this.startFromSetup(true),
      settingsChanged: () => this.applySettings(),
    };
    this.ui.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) this.audio.play('click');
    });
  }

  start(): void {
    this.backdrop.start();
    this.ctx.go.menu();
  }

  private show(screenEl: HTMLElement): void {
    this.ui.replaceChildren(screenEl);
    this.ui.hidden = false;
    document.body.classList.remove('in-match');
    // Move focus to the new screen for keyboard and screen-reader users.
    const focusTarget = screenEl.querySelector<HTMLElement>('h1, .menu-item, button');
    if (focusTarget) {
      if (focusTarget.tagName === 'H1') focusTarget.tabIndex = -1;
      focusTarget.focus({ preventScroll: true });
    }
  }

  private applySettings(): void {
    const s = this.save.get().settings;
    setLanguage(s.language);
    this.audio.setVolumes({ master: s.masterVolume, sfx: s.sfxVolume, crowd: s.crowdVolume });
    const preset = QUALITY_PRESETS[s.quality];
    if (preset.id !== this.renderer.preset.id && this.renderer.setQuality(preset)) this.backdrop.rebuild();
  }

  private startFromSetup(practice: boolean): void {
    const data = this.save.get();
    const setup = data.lastSetup;
    const my = data.myPlayer;
    const useMy = my !== null && (practice || setup.useMyPlayer);
    const config: MatchConfig = {
      mode: practice ? 'practice' : setup.mode,
      seed: hashSeed(`${Date.now()}-${Math.random()}`),
      difficulty: setup.difficulty,
      homeTeamId: setup.homeTeamId,
      awayTeamId: setup.awayTeamId,
      ...(useMy && my ? { homeStar: { def: myPlayerDef(my), skills: my.equippedSkills } } : {}),
    };
    this.launch(config, [getTeam(setup.homeTeamId), getTeam(setup.awayTeamId)]);
  }

  private launch(config: MatchConfig, teams: readonly [TeamDef, TeamDef]): void {
    this.endSession();
    this.lastConfig = { config, teams };
    this.ui.hidden = true;
    this.ui.replaceChildren();
    document.body.classList.add('in-match');
    this.backdrop.stop();
    this.enterImmersive();
    try {
      this.session = new GameSession(config, teams, this.save.get().settings, this.renderer, this.audio, this.overlay, {
        onFinish: (result) => this.onFinish(result),
        onQuit: () => this.quitToMenu(),
        onRestart: () => this.launch({ ...config, seed: hashSeed(`${Date.now()}-r`) }, teams),
      });
      this.session.start();
      if (this.save.get().settings.debug) void this.session.toggleDebug();
    } catch (error) {
      log.error('failed to start match', error);
      this.quitToMenu();
    }
  }

  /** Fullscreen + landscape lock where supported (mobile browsers / installed PWA). */
  private enterImmersive(): void {
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    const el = document.documentElement;
    if (!document.fullscreenElement && typeof el.requestFullscreen === 'function') {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
        .catch(() => undefined);
    }
  }

  private endSession(): void {
    this.session?.dispose();
    this.session = null;
  }

  private quitToMenu(): void {
    this.endSession();
    this.backdrop.start();
    this.ctx.go.menu();
  }

  private onFinish(result: MatchResult): void {
    this.endSession();
    this.backdrop.start();
    const progress = this.applyProgression(result);
    const teams = this.lastConfig?.teams ?? [getTeam(result.config.homeTeamId), getTeam(result.config.awayTeamId)];
    this.show(
      createResultsScreen(
        result,
        teams,
        progress,
        () => this.ctx.go.menu(),
        () => this.lastConfig && this.launch({ ...this.lastConfig.config, seed: hashSeed(`${Date.now()}-rm`) }, this.lastConfig.teams),
      ),
    );
  }

  /** Awards XP/career stats to the user's created player (local, single-player progression). */
  private applyProgression(result: MatchResult): ProgressSummary | null {
    const mode = MODES[result.config.mode];
    const mine = result.players.find((p) => p.defId === 'my-player');
    if (!mode.grantsProgression || !mine || !this.save.get().myPlayer) return null;
    const won = result.winner === result.humanTeam;
    const xp = matchXp(mine.stats, won, result.config.difficulty, result.config.mode);
    let summary: ProgressSummary | null = null;
    this.save.update((d) => {
      if (!d.myPlayer) return;
      const outcome = applyXp(d.myPlayer, xp);
      d.myPlayer = outcome.player;
      d.career.games++;
      if (won) d.career.wins++;
      d.career.points += mine.stats.points;
      d.career.rebounds += mine.stats.oreb + mine.stats.dreb;
      d.career.assists += mine.stats.assists;
      d.career.steals += mine.stats.steals;
      d.career.blocks += mine.stats.blocks;
      summary = {
        xp,
        level: outcome.player.level,
        levelsGained: outcome.levelsGained,
        newSkills: outcome.newSkills,
        xpInLevel: outcome.player.xp,
        xpToNext: xpToNext(outcome.player.level),
      };
    });
    return summary;
  }
}

export function renderFatalError(root: HTMLElement, message: string): void {
  root.replaceChildren(h('div', { class: 'fatal', attrs: { role: 'alert' } }, h('p', { text: message })));
}

