import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

type Rates = { USD: number; INR: number; EUR: number; GBP: number; JPY: number };

type FxState = {
  rates: Rates | null;
  snapshotDate: string | null;
  syncing: boolean;              // true briefly when today's rates are freshly refreshed
  refresh: () => Promise<void>;
  convert: (amount: number, from: string, to: string) => number;
};

const FxContext = createContext<FxState | null>(null);

export function FxProvider({ children }: { children: React.ReactNode }) {
  const [rates, setRates] = useState<Rates | null>(null);
  const [snapshotDate, setSnapshotDate] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await api.fx();
      setRates(r.rates);
      setSnapshotDate(r.snapshot_date || null);
      if (r.refreshed_today) {
        setSyncing(true);
        setTimeout(() => setSyncing(false), 2200);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const convert = useCallback((amount: number, from: string, to: string) => {
    if (!rates || !amount) return amount;
    const f = (from || 'USD').toUpperCase() as keyof Rates;
    const t = (to || 'USD').toUpperCase() as keyof Rates;
    if (f === t) return amount;
    if (!rates[f] || !rates[t]) return amount;
    const usd = amount / rates[f];
    return usd * rates[t];
  }, [rates]);

  return (
    <FxContext.Provider value={{ rates, snapshotDate, syncing, refresh, convert }}>
      {children}
    </FxContext.Provider>
  );
}

export function useFx() {
  const ctx = useContext(FxContext);
  if (!ctx) return { rates: null, snapshotDate: null, syncing: false, refresh: async () => {}, convert: (a: number) => a };
  return ctx;
}
