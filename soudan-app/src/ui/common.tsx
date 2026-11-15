import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from '../lib/store';
import { isOvertime } from '../lib/queue';
import { CATEGORY_LABEL, minutesBetween } from '../lib/format';
import type { Category, Desk } from '../lib/types';

/** #/board, #/desk/3, #/visitors, #/visitor/<id>, #/register, #/admin */
export function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => { setHash(location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}
export const go = (path: string) => { location.hash = `#/${path}`; };

export function useDeskMap(): Map<number, Desk> {
  const { snap } = useStore();
  return new Map((snap?.desks ?? []).map((d) => [d.id, d]));
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose}>閉じる</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Badge({ kind, children }: { kind: 'wait' | 'serve' | 'done' | 'warn' | 'off' | 'info'; children: ReactNode }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return <a className="back" href={`#/${to}`}>‹ {children}</a>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export const CATEGORIES: Category[] = ['public', 'private', 'finance'];

/** 相談先の区分(公的機関等 / 民間協会 / 金融機関)を色つきで示す */
export function CategoryTag({ category }: { category: Category }) {
  return <span className={`cat-tag cat-${category}`}>{CATEGORY_LABEL[category]}</span>;
}

/** 相談中の経過時間。大きく表示し、20分を超えたら赤で強調する */
export function Elapsed({ startedAt, nowMs }: { startedAt: string | null; nowMs: number }) {
  const m = minutesBetween(startedAt, nowMs);
  if (m === null) return null;
  const over = isOvertime(m);
  return (
    <span className={`elapsed ${over ? 'over' : ''}`} title={over ? '相談時間が20分を超えています' : undefined}>
      <b>{m}</b>分経過{over && <em>20分超</em>}
    </span>
  );
}
