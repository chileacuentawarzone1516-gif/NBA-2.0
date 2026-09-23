import { LANGUAGES } from '../../data/i18n';
import { t } from '../../data/i18n';
import { QUALITY_IDS } from '../../data/quality';
import type { Settings } from '../../save/schema';
import { screen, segmented, slider, toggle } from '../components';
import { h } from '../dom';
import type { UiContext } from './context';

export function createSettingsScreen(ctx: UiContext): HTMLElement {
  const s = ctx.save.get().settings;
  const set = (mutate: (settings: Settings) => void, rerender = false): void => {
    ctx.save.update((d) => mutate(d.settings));
    ctx.settingsChanged();
    if (rerender) ctx.go.settings();
  };
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const section = (title: string, ...children: HTMLElement[]): HTMLElement =>
    h('fieldset', { class: 'settings-section' }, h('legend', { text: title }), ...children);

  return screen(
    t('settings.title'),
    () => ctx.go.menu(),
    t('menu.back'),
    h(
      'div',
      { class: 'settings-grid' },
      section(
        t('settings.graphics'),
        segmented(t('settings.quality'), QUALITY_IDS.map((q) => ({ value: q, label: t(`quality.${q}`) })), s.quality, (q) => set((d) => void (d.quality = q))),
        toggle(t('settings.autoQuality'), s.autoResolution, (on) => set((d) => void (d.autoResolution = on))),
      ),
      section(
        t('settings.audio'),
        slider(t('settings.master'), s.masterVolume, 0, 1, 0.05, pct, (v) => set((d) => void (d.masterVolume = v))),
        slider(t('settings.sfx'), s.sfxVolume, 0, 1, 0.05, pct, (v) => set((d) => void (d.sfxVolume = v))),
        slider(t('settings.crowd'), s.crowdVolume, 0, 1, 0.05, pct, (v) => set((d) => void (d.crowdVolume = v))),
      ),
      section(
        t('settings.controls'),
        toggle(t('settings.shotAssist'), s.shotAssist, (on) => set((d) => void (d.shotAssist = on))),
        slider(t('settings.stickSize'), s.touch.stickRadius, 40, 110, 2, (v) => `${v}px`, (v) => set((d) => void (d.touch.stickRadius = v))),
        slider(t('settings.deadZone'), s.touch.deadZone, 0, 0.4, 0.02, pct, (v) => set((d) => void (d.touch.deadZone = v))),
        slider(t('settings.sensitivity'), s.touch.sensitivity, 0.6, 2, 0.05, (v) => v.toFixed(2), (v) => set((d) => void (d.touch.sensitivity = v))),
        slider(t('settings.buttonScale'), s.touch.buttonScale, 0.75, 1.4, 0.05, pct, (v) => set((d) => void (d.touch.buttonScale = v))),
        toggle(t('settings.haptics'), s.touch.haptics, (on) => set((d) => void (d.touch.haptics = on))),
      ),
      section(
        t('settings.camera'),
        slider(t('settings.cameraHeight'), s.camera.height, 4.5, 11, 0.1, (v) => `${v.toFixed(1)} m`, (v) => set((d) => void (d.camera.height = v))),
        slider(t('settings.cameraDistance'), s.camera.distance, 7, 15, 0.1, (v) => `${v.toFixed(1)} m`, (v) => set((d) => void (d.camera.distance = v))),
      ),
      section(
        t('settings.language'),
        segmented(t('settings.language'), LANGUAGES.map((l) => ({ value: l, label: l === 'es' ? 'Español' : 'English' })), s.language, (l) => set((d) => void (d.language = l), true)),
        toggle(t('settings.debug'), s.debug, (on) => set((d) => void (d.debug = on))),
      ),
    ),
  );
}
