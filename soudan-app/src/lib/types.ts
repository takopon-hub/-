export type Role = 'operator' | 'viewer';
export type TicketStatus = 'waiting' | 'serving' | 'done' | 'cancelled' | 'moved' | 'away';
/** public=公的機関等 / private=民間協会 / finance=金融機関 */
export type Category = 'public' | 'private' | 'finance';

export interface Desk {
  id: number;
  name: string;
  category: Category;
  booths: number;
  active: boolean;
  sort: number;
}

export interface Visitor {
  id: string;
  no: number;
  surname: string;
  status: 'in' | 'left';
  /** 相談を希望する相談先(最初に並ぶ先を含む。あとから並んだ先も加わる) */
  wishes: number[];
  createdAt: string;
  /** 操作者にだけ含まれる */
  memo?: string;
}

export interface Ticket {
  id: string;
  visitorId: string;
  deskId: number;
  status: TicketStatus;
  booth: number | null;
  /** 実際に並んだ時刻 */
  queuedAt: string;
  /** 行列内の順序(離席による入れ替えで変わる)。snapshot の配列はこの順に並んでいる */
  queueAt: string;
  startedAt: string | null;
  endedAt: string | null;
}

export interface Snapshot {
  role: Role;
  now: string;
  desks: Desk[];
  visitors: Visitor[];
  tickets: Ticket[];
}
