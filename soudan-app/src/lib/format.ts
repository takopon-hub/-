import type { Category, TicketStatus } from './types';

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
  away: '離席中',
  serving: '相談中',
  done: '相談済み',
  cancelled: '取消',
  moved: '付け替え',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  public: '公的機関等',
  private: '民間協会',
  finance: '金融機関',
};

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  // 非セキュアコンテキスト用のフォールバック(UUID v4 形式)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 相談者の呼び名。個人情報は持たないので受付番号だけで呼ぶ(例: 012番) */
export const noLabel = (v: { no: number } | null | undefined): string => (v ? `${pad3(v.no)}番` : '');
