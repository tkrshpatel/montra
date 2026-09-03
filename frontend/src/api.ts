import { getToken, clearToken } from './auth/tokenStore';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL as string;

async function req(path: string, init: RequestInit = {}) {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as any || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}/api${path}`, { ...init, headers });
  if (res.status === 401) {
    await clearToken();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  authSession: (session_id: string) =>
    req('/auth/session', { method: 'POST', body: JSON.stringify({ session_id }) }),
  me: () => req('/auth/me'),
  logout: () => req('/auth/logout', { method: 'POST' }),
  setCurrency: (currency: string) =>
    req('/auth/currency', { method: 'POST', body: JSON.stringify({ currency }) }),

  listExpenses: () => req('/expenses'),
  createExpense: (data: any) =>
    req('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  deleteExpense: (id: string) => req(`/expenses/${id}`, { method: 'DELETE' }),

  listFriends: () => req('/friends'),
  createFriend: (data: any) =>
    req('/friends', { method: 'POST', body: JSON.stringify(data) }),
  deleteFriend: (id: string) => req(`/friends/${id}`, { method: 'DELETE' }),

  balances: () => req('/balances'),

  listGroups: () => req('/groups'),
  createGroup: (data: any) => req('/groups', { method: 'POST', body: JSON.stringify(data) }),
  deleteGroup: (id: string) => req(`/groups/${id}`, { method: 'DELETE' }),

  listRecurring: () => req('/recurring'),
  createRecurring: (data: any) => req('/recurring', { method: 'POST', body: JSON.stringify(data) }),
  deleteRecurring: (id: string) => req(`/recurring/${id}`, { method: 'DELETE' }),

  listSettlements: () => req('/settlements'),
  createSettlement: (data: any) => req('/settlements', { method: 'POST', body: JSON.stringify(data) }),

  fx: () => req('/fx'),

  insights: (month?: string) => req(`/insights${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  getReceipt: (id: string) => req(`/expenses/${id}/receipt`),

  scan: (image_base64: string, mime_type = 'image/jpeg') =>
    req('/scan', { method: 'POST', body: JSON.stringify({ image_base64, mime_type }) }),
};

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  currency: string;
};
