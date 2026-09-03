import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { api, User } from '../api';
import { saveToken, clearToken, getToken } from './tokenStore';

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  loading: boolean;
  user: User | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const processedSessionIds = new Set<string>();

function extractSessionId(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/[?#&]session_id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const exchange = useCallback(async (session_id: string) => {
    if (processedSessionIds.has(session_id)) return;
    processedSessionIds.add(session_id);
    try {
      const resp = await api.authSession(session_id);
      await saveToken(resp.session_token);
      setUser(resp.user);
    } catch (e) {
      console.warn('session exchange failed', e);
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) { setUser(null); return; }
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      await clearToken();
      setUser(null);
    }
  }, []);

  // Initial load + deep link listener
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // Web: parse URL for session_id first
        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const href = window.location.href;
          const sid = extractSessionId(href);
          if (sid) {
            await exchange(sid);
            // clean URL
            try {
              const url = new URL(window.location.href);
              url.hash = '';
              url.searchParams.delete('session_id');
              window.history.replaceState(window.history.state, '', url.toString());
            } catch {}
          }
        } else {
          const initial = await Linking.getInitialURL();
          const sid = extractSessionId(initial);
          if (sid) await exchange(sid);
        }
        await refresh();
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const sub = Linking.addEventListener('url', ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) exchange(sid).then(() => refresh());
    });

    return () => {
      mounted = false;
      sub.remove();
    };
  }, [exchange, refresh]);

  const signIn = useCallback(async () => {
    const redirectUrl = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.location.origin + '/' : '/')
      : Linking.createURL('');
    const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined') window.location.href = authUrl;
      return;
    }

    let capturedUrl: string | null = null;
    const listener = Linking.addEventListener('url', ({ url }) => { capturedUrl = url; });
    try {
      const result: any = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      let url: string | null = result?.url || null;
      if (!url) url = capturedUrl;
      if (!url) url = await Linking.getInitialURL();
      const sid = extractSessionId(url);
      if (sid) {
        await exchange(sid);
        await refresh();
      }
    } catch (e) {
      console.warn('signIn error', e);
    } finally {
      listener.remove();
    }
  }, [exchange, refresh]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, user, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
