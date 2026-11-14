export type Role = 'operator' | 'viewer';
export type LeaveKind = 'done' | 'carryover' | 'dropped';
export type TicketStatus = 'waiting' | 'serving' | 'done' | 'cancelled';

export interface Desk {
  id: number;
  name: string;
  booths: number;
  active: boolean;
  sort: number;
}

export interface Visitor {
  id: string;
  no: number;
  surname: string;
  status: 'in' | 'left';
  leaveKind: LeaveKind | null;
  createdAt: string;
  /** 操作者にだけ含まれる */
  phone?: string;
  memo?: string;
}

export interface Ticket {
  id: string;
  visitorId: string;
  deskId: number;
  status: TicketStatus;
  booth: number | null;
  queuedAt: string;
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
