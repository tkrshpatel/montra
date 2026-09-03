import Constants from 'expo-constants';
import { getToken, clearToken } from './auth/tokenStore';

// Prefer build-time env; fall back to expoConfig.extra (helps if env isn't baked into a native build).
const BASE =
  (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
  ((Constants?.expoConfig?.extra as any)?.EXPO_PUBLIC_BACKEND_URL as string | undefined) ||
  '';

// Per-request timeout so requests never hang forever on a flaky network.
const DEFAULT_TIMEOUT_MS = 30_000;

async function req(path: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
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
    // Try to surface FastAPI { detail: "..." } payloads
    try {
      const parsed = JSON.parse(text);
      if (parsed?.detail) throw new Error(typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail));
    } catch (e: any) {
      if (e && typeof e.message === 'string' && e.message && !e.message.startsWith('{')) throw e;
    }
    throw new Error(text || `HTTP ${res.status}`);
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res.text();
}

export const api = {
  authSession: (session_id: string) =>
    req('/auth/session', { method: 'POST', body: JSON.stringify({ session_id }) }),
  authApple: (data: { identity_token: string; name?: string | null; email?: string | null }) =>
    req('/auth/apple', { method: 'POST', body: JSON.stringify(data) }),
  deleteAccount: () => req('/auth/account', { method: 'DELETE' }),
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
  trends: (months = 6) => req(`/trends?months=${months}`),
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
