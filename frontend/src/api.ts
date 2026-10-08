import Constants from 'expo-constants';
import { getToken, clearToken } from './auth/tokenStore';

// Prefer build-time env; fall back to expoConfig.extra (helps if env isn't baked into a native build).
const BASE =
  (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
  ((Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
  '';

// Per-request timeout so requests never hang forever on a flaky network.
const DEFAULT_TIMEOUT_MS = 30_000;

export async function request(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const token = await getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as any || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!BASE) {
    throw new Error('Backend URL is not configured. Please reinstall the app.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, { ...init, headers, signal: controller.signal });
  } catch (netErr: any) {
    if (netErr?.name === 'AbortError') {
      throw new Error('Request timed out. Please try again.');
    }
    throw new Error(netErr?.message ? `Network error: ${netErr.message}` : 'Network error. Please check your connection.');
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    await clearToken();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail: unknown;
    try { detail = JSON.parse(text)?.detail; } catch { /* Non-JSON gateway error. */ }
    throw new Error(typeof detail === 'string' ? detail : detail ? 'Please check the entered details.' : `Request failed (${res.status}). Please try again.`);
  }

  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  authStart: (redirect_uri: string, code_challenge: string) =>
    request('/auth/google/start', { method: 'POST', body: JSON.stringify({ redirect_uri, code_challenge }) }),
  authExchange: (code: string, code_verifier: string) =>
    request('/auth/google/exchange', { method: 'POST', body: JSON.stringify({ code, code_verifier }) }),
  authApple: (data: { identity_token: string; name?: string | null; email?: string | null }) =>
    request('/auth/apple', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccount: () => request('/auth/account', { method: 'DELETE' }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  setCurrency: (currency: string) =>
    request('/auth/currency', { method: 'POST', body: JSON.stringify({ currency }) }),

  listExpenses: () => request('/expenses'),
  createExpense: (data: any) =>
    request('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  deleteExpense: (id: string) => request(`/expenses/${id}`, { method: 'DELETE' }),

  listFriends: () => request('/friends'),
  createFriend: (data: any) =>
    request('/friends', { method: 'POST', body: JSON.stringify(data) }),
  deleteFriend: (id: string) => request(`/friends/${id}`, { method: 'DELETE' }),
  friendHistory: (id: string) => request(`/friends/${id}/history`),

  balances: () => request('/balances'),

  listGroups: () => request('/groups'),
  createGroup: (data: any) => request('/groups', { method: 'POST', body: JSON.stringify(data) }),
  deleteGroup: (id: string) => request(`/groups/${id}`, { method: 'DELETE' }),

  listRecurring: () => request('/recurring'),
  createRecurring: (data: any) => request('/recurring', { method: 'POST', body: JSON.stringify(data) }),
  deleteRecurring: (id: string) => request(`/recurring/${id}`, { method: 'DELETE' }),

  listSettlements: () => request('/settlements'),
  createSettlement: (data: any) => request('/settlements', { method: 'POST', body: JSON.stringify(data) }),

  fx: () => request('/fx'),

  insights: (month?: string) => request(`/insights${month ? `?month=${encodeURIComponent(month)}` : ''}`),
  trends: (months = 6) => request(`/trends?months=${months}`),
  getReceipt: (id: string) => request(`/expenses/${id}/receipt`),

  scan: (image_base64: string, mime_type = 'image/jpeg') =>
    request('/scan', { method: 'POST', body: JSON.stringify({ image_base64, mime_type }) }),
};

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  currency: string;
};
