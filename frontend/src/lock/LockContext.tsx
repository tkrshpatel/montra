import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { storage } from '@/src/utils/storage';

type LockCtx = {
  enabled: boolean;              // user preference
  supported: boolean;             // hardware supports biometrics
  enrolled: boolean;              // has biometrics enrolled
  available: boolean;             // supported && enrolled && not web
  locked: boolean;                // current lock state
  setEnabled: (v: boolean) => Promise<boolean>;  // returns final state
  unlock: () => Promise<boolean>;
  lock: () => void;
};

const KEY = 'splitsync_biometric_lock';
const Ctx = createContext<LockCtx | null>(null);

export function LockProvider({ children, isLoggedIn }: { children: React.ReactNode; isLoggedIn: boolean }) {
  const [enabled, setEnabledState] = useState(false);
  const [supported, setSupported] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [locked, setLocked] = useState(false);
  const [checked, setChecked] = useState(false);
  const appState = useRef(AppState.currentState);

  const available = supported && enrolled && Platform.OS !== 'web';

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS !== 'web') {
          const hw = await LocalAuthentication.hasHardwareAsync();
          const en = await LocalAuthentication.isEnrolledAsync();
          setSupported(hw);
          setEnrolled(en);
        }
      } catch {}
      try {
        const v = await storage.getItem<boolean>(KEY, false);
        setEnabledState(!!v);
        if (v && isLoggedIn && Platform.OS !== 'web') setLocked(true);
      } catch {}
      setChecked(true);
    })();
    // We intentionally read isLoggedIn only on mount for initial lock decision
    // to avoid re-locking when a session refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-lock when returning from background if enabled
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const prev = appState.current;
      appState.current = next;
      if (!enabled || Platform.OS === 'web') return;
      if (prev.match(/inactive|background/) && next === 'active') {
        setLocked(true);
      }
    });
    return () => sub.remove();
  }, [enabled]);

  // If user logs out, clear locked state
  useEffect(() => {
    if (!isLoggedIn) setLocked(false);
  }, [isLoggedIn]);

  const unlock = useCallback(async () => {
    if (Platform.OS === 'web') { setLocked(false); return true; }
    try {
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock Montra',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (res.success) {
        setLocked(false);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(() => setLocked(true), []);

  const setEnabled = useCallback(async (v: boolean) => {
    if (v && Platform.OS !== 'web') {
      // require a successful biometric prompt to turn ON
      const ok = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Enable biometric lock',
        cancelLabel: 'Cancel',
      });
      if (!ok.success) return enabled;
    }
    setEnabledState(v);
    try { await storage.setItem(KEY, v); } catch {}
    return v;
  }, [enabled]);

  const value: LockCtx = {
    enabled, supported, enrolled, available,
    locked: locked && checked,
    setEnabled, unlock, lock,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLock(): LockCtx {
  const ctx = useContext(Ctx);
  if (!ctx) return {
    enabled: false, supported: false, enrolled: false, available: false, locked: false,
    setEnabled: async () => false, unlock: async () => true, lock: () => {},
  };
  return ctx;
}
