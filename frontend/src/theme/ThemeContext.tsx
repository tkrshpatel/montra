import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { Appearance } from 'react-native';
import { storage } from '@/src/utils/storage';
import { LIGHT, DARK, Palette } from './palette';

type Mode = 'system' | 'light' | 'dark';

type ThemeCtx = {
  mode: Mode;
  colors: Palette;
  isDark: boolean;
  setMode: (m: Mode) => Promise<void>;
};

const Ctx = createContext<ThemeCtx | null>(null);
const KEY = 'splitsync_theme_mode';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<Mode>('system');
  const [system, setSystem] = useState(Appearance.getColorScheme() || 'light');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const v = await storage.getItem<string>(KEY, 'system');
        if (v === 'light' || v === 'dark' || v === 'system') setModeState(v);
      } catch {}
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystem(colorScheme || 'light');
    });
    return () => sub.remove();
  }, []);

  const setMode = useCallback(async (m: Mode) => {
    setModeState(m);
    try { await storage.setItem(KEY, m); } catch {}
  }, []);

  const isDark = mode === 'dark' || (mode === 'system' && system === 'dark');
  const colors = isDark ? DARK : LIGHT;

  const value = useMemo(() => ({ mode, colors, isDark, setMode }), [mode, colors, isDark, setMode]);

  // Avoid flash before loaded — but still render children (no gate)
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Sensible default before provider mounts (should not happen after wrap)
    return { mode: 'light', colors: LIGHT, isDark: false, setMode: async () => {} };
  }
  return ctx;
}
