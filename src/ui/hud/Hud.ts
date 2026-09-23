import { t, type I18nKey } from '../../data/i18n';
import { STAMINA, type TimingGrade } from '../../data/tuning';
import { colorToCss, type TeamDef } from '../../data/teams';
import type { MatchState } from '../../sim/types';
import { h } from '../dom';

/**
 * In-match HUD (DOM overlay: crisp text at any DPI, accessible, cheap to update).
 * All setters cache the last value so the DOM is only touched on change.
 */
export interface ShotMeterState {
  visible: boolean;
  /** Seconds into the shot. */
  t: number;
  releaseTime: number;
  perfect: number;
  good: number;
  ok: number;
  x: number;
  y: number;
}

type ToastKind = 'score' | 'big' | 'info' | 'grade-perfect' | 'grade-good' | 'grade-bad';

export class Hud {
  readonly root: HTMLElement;
  private readonly homeScore: HTMLElement;
  private readonly awayScore: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly shotClock: HTMLElement;
  private readonly status: HTMLElement;
  private readonly clearBadge: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly staminaName: HTMLElement;
  private readonly feed: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly meterPerfect: HTMLElement;
  private readonly meterGood: HTMLElement;
  private readonly possessionHome: HTMLElement;
  private readonly possessionAway: HTMLElement;
  private readonly cache = new Map<string, string | number | boolean>();

  constructor(parent: HTMLElement, teams: readonly [TeamDef, TeamDef], hasOpponent: boolean, onPause: () => void) {
    const [home, away] = teams;
    this.homeScore = h('span', { class: 'sb-score', text: '0' });
    this.awayScore = h('span', { class: 'sb-score', text: '0' });
    this.clock = h('span', { class: 'sb-clock', text: '--:--' });
    this.shotClock = h('span', { class: 'sb-shotclock' });
    this.status = h('span', { class: 'sb-status' });
    this.possessionHome = h('span', { class: 'sb-poss', attrs: { 'aria-hidden': 'true' } });
    this.possessionAway = h('span', { class: 'sb-poss', attrs: { 'aria-hidden': 'true' } });
    const teamBlock = (team: TeamDef, score: HTMLElement, poss: HTMLElement, side: 'home' | 'away'): HTMLElement =>
      h(
        'div',
        { class: `sb-team sb-${side}`, style: { '--team': colorToCss(team.colors.primary) } },
        side === 'home' ? poss : null,
        h('span', { class: 'sb-name', text: team.short }),
        score,
        side === 'away' ? poss : null,
      );
    const scoreboard = h(
      'div',
      { class: 'scoreboard', attrs: { role: 'status', 'aria-live': 'off' } },
      teamBlock(home, this.homeScore, this.possessionHome, 'home'),
      h('div', { class: 'sb-center' }, this.clock, this.shotClock, this.status),
      hasOpponent ? teamBlock(away, this.awayScore, this.possessionAway, 'away') : null,
    );
    this.clearBadge = h('div', { class: 'clear-badge', text: t('hud.clear'), attrs: { hidden: true } });
    this.staminaFill = h('div', { class: 'stamina-fill' });
    this.staminaName = h('span', { class: 'stamina-name' });
    const stamina = h(
      'div',
      { class: 'stamina', attrs: { role: 'meter', 'aria-label': t('hud.stamina'), 'aria-valuemin': 0, 'aria-valuemax': 100 } },
      this.staminaName,
      h('div', { class: 'stamina-bar' }, this.staminaFill),
    );
    const pause = h('button', { class: 'hud-pause', attrs: { type: 'button', 'aria-label': t('hud.pause') }, on: { click: onPause } }, h('span', { class: 'pause-icon' }));
    this.feed = h('div', { class: 'feed', attrs: { 'aria-live': 'polite' } });
    this.meterFill = h('div', { class: 'meter-fill' });
    this.meterPerfect = h('div', { class: 'meter-perfect' });
    this.meterGood = h('div', { class: 'meter-good' });
    this.meter = h('div', { class: 'shot-meter', attrs: { hidden: true, 'aria-hidden': 'true' } }, this.meterGood, this.meterPerfect, this.meterFill);
    this.root = h('div', { class: 'hud' }, scoreboard, this.clearBadge, stamina, pause, this.feed, this.meter);
    parent.append(this.root);
  }

  private changed(key: string, value: string | number | boolean): boolean {
    if (this.cache.get(key) === value) return false;
    this.cache.set(key, value);
    return true;
  }

  updateMatch(match: MatchState, practice: boolean): void {
    if (this.changed('home', match.score[0])) this.homeScore.textContent = String(match.score[0]);
    if (this.changed('away', match.score[1])) this.awayScore.textContent = String(match.score[1]);
    const clockText = practice ? t('hud.practice') : match.overtime ? t('hud.overtime') : formatClock(match.gameClock);
    if (this.changed('clock', clockText)) this.clock.textContent = clockText;
    const shot = match.shotClock === null || practice ? '' : String(Math.ceil(match.shotClock));
    if (this.changed('shot', shot)) this.shotClock.textContent = shot;
    const urgent = match.shotClock !== null && match.shotClock <= 5 && match.phase === 'live';
    if (this.changed('urgent', urgent)) this.shotClock.classList.toggle('urgent', urgent);
    if (this.changed('clear', match.needsClear)) this.clearBadge.hidden = !match.needsClear;
    if (this.changed('poss', match.offense)) {
      this.possessionHome.classList.toggle('on', match.offense === 0);
      this.possessionAway.classList.toggle('on', match.offense === 1);
    }
  }

  updateStamina(name: string, stamina: number, exhausted: boolean): void {
    if (this.changed('sname', name)) this.staminaName.textContent = name;
    const pct = Math.round((stamina / STAMINA.max) * 100);
    if (this.changed('stam', pct)) {
      this.staminaFill.style.transform = `scaleX(${pct / 100})`;
      this.staminaFill.parentElement?.parentElement?.setAttribute('aria-valuenow', String(pct));
    }
    const low = exhausted || pct < 25;
    if (this.changed('low', low)) this.staminaFill.classList.toggle('low', low);
  }

  updateShotMeter(state: ShotMeterState): void {
    if (this.changed('meter', state.visible)) this.meter.hidden = !state.visible;
    if (!state.visible) return;
    const total = state.releaseTime + state.ok;
    const fill = Math.min(1, state.t / total);
    this.meterFill.style.transform = `scaleY(${fill})`;
    this.meter.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px)`;
    const key = `${state.releaseTime}:${state.perfect}:${state.good}`;
    if (this.changed('meterWin', key)) {
      const band = (half: number, el: HTMLElement): void => {
        el.style.bottom = `${((state.releaseTime - half) / total) * 100}%`;
        el.style.height = `${((half * 2) / total) * 100}%`;
      };
      band(state.good, this.meterGood);
      band(state.perfect, this.meterPerfect);
    }
  }

  showGrade(grade: TimingGrade, pct: number, contest: number): void {
    const gradeKey: Record<TimingGrade, I18nKey> = { perfect: 'feed.perfect', good: 'feed.good', early: 'feed.early', late: 'feed.late', poor: 'feed.poor' };
    const kind: ToastKind = grade === 'perfect' ? 'grade-perfect' : grade === 'good' ? 'grade-good' : 'grade-bad';
    const detail = `${t(contest > 0.45 ? 'feed.contested' : 'feed.open')} · ${t('feed.chance', { pct: Math.round(pct * 100) })}`;
    this.toast(`${t(gradeKey[grade])}`, kind, detail);
  }

  toast(text: string, kind: ToastKind = 'info', detail?: string): void {
    const item = h('div', { class: `toast toast-${kind}` }, h('span', { class: 'toast-main', text }), detail ? h('span', { class: 'toast-detail', text: detail }) : null);
    this.feed.append(item);
    while (this.feed.childElementCount > 3) this.feed.firstElementChild?.remove();
    window.setTimeout(() => item.classList.add('out'), kind === 'big' || kind === 'score' ? 1500 : 1100);
    window.setTimeout(() => item.remove(), kind === 'big' || kind === 'score' ? 1900 : 1500);
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  dispose(): void {
    this.root.remove();
  }
}

export function formatClock(seconds: number | null): string {
  if (seconds === null) return '--:--';
  if (seconds < 10) return seconds.toFixed(1);
  const s = Math.ceil(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

