import { Fragment, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { translations } from './messages';
export type AppLanguage = 'en' | 'sv' | 'nb';
const normalize = (v: string): AppLanguage => v.startsWith('sv') ? 'sv' : /^(nb|no)/.test(v) ? 'nb' : 'en';
let language: AppLanguage = normalize(localStorage.getItem('ol-grafik-language') || 'en');
const listeners = new Set<() => void>();
export function setAppLanguage(value: string) {
  language = normalize(value);
  localStorage.setItem('ol-grafik-language', language);
  document.documentElement.lang = language;
  listeners.forEach(fn => fn());
}
export function t(text: string | undefined): string {
  if (!text) return "";
  return language === 'en' ? text : translations[text]?.[language] || text;
}
export function LanguageProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => language);
  useEffect(() => {
    document.documentElement.lang = language;
    window.electronAPI.invoke('settings:get').then(result => {
      if (result.success) setAppLanguage(result.data.general.langfile || 'en');
    }).catch(() => undefined);
    const sync = (event: StorageEvent) => { if (event.key === 'ol-grafik-language' && event.newValue) setAppLanguage(event.newValue); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return <Fragment key={locale}>{children}</Fragment>;
}
