import { useState } from 'react';
import { getTheme, setTheme, type Theme } from '../lib/theme';

const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
const LABEL: Record<Theme, string> = { auto: '自動', light: 'ライト', dark: 'ダーク' };

/** 画面上部の表示切り替え(自動 → ライト → ダーク)。操作者・閲覧者のどちらも使える。この端末だけの設定。 */
export function ThemeButton() {
  const [t, setT] = useState<Theme>(getTheme());
  return (
    <button className="btn ghost small theme-btn" aria-label={`画面の表示: ${LABEL[t]}(押すと切り替え)`}
      onClick={() => { const n = NEXT[t]; setT(n); setTheme(n); }}>
      ◐ {LABEL[t]}
    </button>
  );
}
