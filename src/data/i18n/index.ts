import { en } from './en';
import { es, type I18nKey } from './es';

export type Language = 'es' | 'en';
export const LANGUAGES: readonly Language[] = ['es', 'en'];

const DICTIONARIES: Record<Language, Record<I18nKey, string>> = { es, en };
let current: Language = 'es';

export function detectLanguage(): Language {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'es';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function setLanguage(language: Language): void {
  current = language;
  if (typeof document !== 'undefined') document.documentElement.lang = language;
}

export function getLanguage(): Language {
  return current;
}

/** Translates a key, interpolating `{name}` placeholders. */
export function t(key: I18nKey, params?: Record<string, string | number>): string {
  const template = DICTIONARIES[current][key] ?? es[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => (name in params ? String(params[name]) : `{${name}}`));
}

export type { I18nKey };
