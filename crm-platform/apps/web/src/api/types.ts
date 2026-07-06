export type Role = 'admin' | 'manager' | 'member';

export interface User {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
}

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  website: string | null;
  phone: string | null;
  ownerId: string | null;
  ownerName: string | null;
  contactCount: number;
  openDealCount: number;
  custom: Record<string, unknown>;
  createdAt: string;
}

export interface Lead {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  source: string | null;
  status: 'new' | 'contacted' | 'qualified' | 'unqualified' | 'converted';
  ownerId: string | null;
  ownerName: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
}

export interface Stage {
  id: string;
  pipelineId?: string;
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  isDefault: boolean;
  stages: Stage[];
}

export interface Deal {
  id: string;
  title: string;
  value: number;
  currency: string;
  pipelineId: string;
  stageId: string;
  stageName: string;
  contactId: string | null;
  contactName: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: 'open' | 'won' | 'lost';
  expectedCloseDate: string | null;
  closedAt: string | null;
  custom: Record<string, unknown>;
  updatedAt: string;
}

export interface BoardStage extends Stage {
  deals: Deal[];
  totalValue: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'done';
  assigneeId: string | null;
  assigneeName: string | null;
  relatedType: string | null;
  relatedId: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface Note {
  id: string;
  body: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

export interface Activity {
  id: string;
  type: string;
  actorName: string | null;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CustomFieldDef {
  id: string;
  entityType: 'contact' | 'company' | 'lead' | 'deal';
  key: string;
  label: string;
  fieldType: 'text' | 'number' | 'date' | 'select' | 'checkbox';
  options: string[];
  required: boolean;
  position: number;
}

export interface Workflow {
  id: string;
  name: string;
  triggerType: string;
  conditions: { field: string; op: string; value?: unknown }[];
  actions: Record<string, unknown>[];
  isActive: boolean;
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
}

export const fmtMoney = (value: number, currency = 'USD'): string =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);

export const fmtDate = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

export const fmtDateTime = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : '—';

export const timeAgo = (iso: string): string => {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return fmtDate(iso);
};
