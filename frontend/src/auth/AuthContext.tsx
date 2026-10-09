import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { api, User } from '../api';
import { saveToken, clearToken, getToken } from './tokenStore';

WebBrowser.maybeCompleteAuthSession();

type AuthState = {
  authError: string | null;
  loading: boolean;
  user: User | null;
  signIn: () => Promise<void>;
  signInApple: () => Promise<void>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

const VERIFIER_KEY = 'montra_oauth_verifier';
async function storeVerifier(value: string | null) {
  if (Platform.OS === 'web') {
    if (value) sessionStorage.setItem(VERIFIER_KEY, value);
    else sessionStorage.removeItem(VERIFIER_KEY);
  } else if (value) await SecureStore.setItemAsync(VERIFIER_KEY, value);
  else await SecureStore.deleteItemAsync(VERIFIER_KEY);
}
async function readVerifier() {
  return Platform.OS === 'web' ? sessionStorage.getItem(VERIFIER_KEY) : SecureStore.getItemAsync(VERIFIER_KEY);
}
let exchangeInFlight: Promise<void> | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  const exchange = useCallback(async (url: string | null) => {
    if (!url) return;
    const params = new URLSearchParams(url.split('#')[1] || '');
    if (params.has('auth_error')) throw new Error(params.get('auth_error')!);
    const code = params.get('auth_code');
    if (!code) return;
    if (exchangeInFlight) return exchangeInFlight;
    exchangeInFlight = (async () => {
      const verifier = await readVerifier();
      if (!verifier) throw new Error('Sign-in expired. Please start again.');
      try {
        const resp = await api.authExchange(code, verifier);
        await saveToken(resp.session_token);
        setUser(resp.user);
      } finally {
        await storeVerifier(null);
        if (Platform.OS === 'web') window.history.replaceState(null, '', window.location.pathname);
      }
    })();
    try { await exchangeInFlight; } finally { exchangeInFlight = null; }
  }, []);

  const refresh = useCallback(async () => {
    const token = await getToken();
    if (!token) { setUser(null); return; }
    try {
      const me = await api.me();
      setUser(me);
    } catch (e: any) {
      if (e.message === "unauthorized") { await clearToken(); setUser(null); }
    }
  }, []);

  const [authError, setAuthError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const initial = Platform.OS === 'web' ? window.location.href : await Linking.getInitialURL();
        await exchange(initial);
        await refresh();
      } catch (e: any) { if (active) setAuthError(e.message); }
      finally { if (active) setLoading(false); }
    })();
    const listener = Linking.addEventListener('url', ({ url }) => {
      exchange(url).catch((e) => setAuthError(e.message));
    });
    return () => { active = false; listener.remove(); };
  }, [exchange, refresh]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    const bytes = await Crypto.getRandomBytesAsync(32);
    const verifier = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    const encoded = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
    const challenge = encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await storeVerifier(verifier);
    const redirect = Platform.OS === 'web' ? window.location.origin + '/' : 'montra://';
    const { url } = await api.authStart(redirect, challenge);
    if (Platform.OS === 'web') { window.location.assign(url); return; }
    const result = await WebBrowser.openAuthSessionAsync(url, redirect);
    if (result.type === 'success') await exchange(result.url);
    else await storeVerifier(null);
  }, [exchange]);

  const signOut = useCallback(async () => {
    try { await api.logout(); } catch {}
    await clearToken();
    setUser(null);
  }, []);

  const signInApple = useCallback(async () => {
    if (Platform.OS !== 'ios') return;
    const AppleAuth = await import('expo-apple-authentication');
    try {
      const available = await AppleAuth.isAvailableAsync();
      if (!available) return;
      const cred = await AppleAuth.signInAsync({
        requestedScopes: [
          AppleAuth.AppleAuthenticationScope.FULL_NAME,
          AppleAuth.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (!cred.identityToken) return;
      const displayName = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(' ') || null;
      const resp = await api.authApple({
        identity_token: cred.identityToken,
        name: displayName,
        email: cred.email,
      });
      await saveToken(resp.session_token);
      setUser(resp.user);
    } catch (e: any) {
      // ERR_CANCELED is fine, ignore
      if (String(e?.code || '').includes('CANCEL')) return;
      throw e;
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    await api.deleteAccount();
    await clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ authError, loading, user, signIn, signInApple, signOut, deleteAccount, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
