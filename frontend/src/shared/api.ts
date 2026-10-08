import { request } from '../api';
export type Member = { user_id: string; name: string; role: 'owner' | 'member' | 'former'; active: boolean };
export type Group = { group_id: string; name: string; currency: string; members: Member[]; created_at: string };
export type Entry = { entry_id: string; kind: 'expense' | 'settlement'; description: string; amount_minor: number;
  paid_by: string; paid_to?: string; created_by: string; created_at: string; expense_date?: string;
  allocations?: Record<string, number>; voided: boolean; void_reason?: string };
export type Balances = { currency: string; total_expenses_minor: number; net: Record<string, number>;
  suggestions: { paid_by: string; paid_to: string; amount_minor: number }[] };
const post = (path: string, data: unknown = {}) => request(path, { method: 'POST', body: JSON.stringify(data) });
const root = '/shared/groups';
export const sharedApi = {
  list: (offset = 0): Promise<{ items: Group[]; has_more: boolean }> => request(`${root}?offset=${offset}`),
  create: (name: string, currency: string): Promise<Group> => post(root, { name, currency }),
  join: (code: string): Promise<Group> => post('/shared/join', { code }),
  group: (id: string): Promise<Group> => request(`${root}/${id}`),
  invite: (id: string): Promise<{ code: string; expires_at: string }> => post(`${root}/${id}/invitation`),
  revoke: (id: string) => request(`${root}/${id}/invitation`, { method: 'DELETE' }),
  entries: (id: string, before?: string): Promise<{ items: Entry[]; next_cursor: string | null }> =>
    request(`${root}/${id}/entries${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  balances: (id: string): Promise<Balances> => request(`${root}/${id}/balances`),
  expense: (id: string, body: unknown) => post(`${root}/${id}/expenses`, body),
  settlement: (id: string, body: unknown) => post(`${root}/${id}/settlements`, body),
  void: (id: string, entry: string, reason: string) => post(`${root}/${id}/entries/${entry}/void`, { reason }),
};
export function money(minor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minor / (currency === 'JPY' ? 1 : 100));
}
export function decimalAmount(minor: number, currency: string) {
  return (minor / (currency === 'JPY' ? 1 : 100)).toFixed(currency === 'JPY' ? 0 : 2);
}
