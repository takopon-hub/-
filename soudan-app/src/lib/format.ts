import type { LeaveKind, TicketStatus } from './types';

export const pad3 = (no: number) => String(no).padStart(3, '0');

export function hhmm(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function minutesBetween(a: string | null, b: string | number | null): number | null {
  if (!a || b === null) return null;
  const end = typeof b === 'number' ? b : Date.parse(b);
  return Math.max(0, Math.round((end - Date.parse(a)) / 60000));
}

export const TICKET_LABEL: Record<TicketStatus, string> = {
  waiting: '待機中',
  serving: '相談中',
  done: '相談済み',
  cancelled: '取消',
};

export const LEAVE_LABEL: Record<LeaveKind, string> = {
  done: '帰宅(相談完了)',
  carryover: '帰宅(持ち帰り)',
  dropped: '帰宅(途中離脱)',
};

/** 090-1234-5678 形式に整形(表示用) */
export function formatPhone(p: string | undefined): string {
  if (!p) return '';
  if (p.length === 11) return `${p.slice(0, 3)}-${p.slice(3, 7)}-${p.slice(7)}`;
  if (p.length === 10) return `${p.slice(0, 2)}-${p.slice(2, 6)}-${p.slice(6)}`;
  return p;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // 非セキュアコンテキスト用のフォールバック(UUID v4 形式)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
