import { storage } from './store';

/** 表示の配色。auto = 端末の設定(ダーク/ライト)に合わせる。この端末だけの設定として保存する。 */
export type Theme = 'auto' | 'light' | 'dark';
const KEY = 'soudan.theme';

export function getTheme(): Theme {
  const v = storage.get(KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
}

export function setTheme(t: Theme) {
  if (t === 'auto') storage.del(KEY); else storage.set(KEY, t);
  applyTheme(t);
}
