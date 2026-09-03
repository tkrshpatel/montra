import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api';

type Rates = { USD: number; INR: number; EUR: number };

type FxState = {
  rates: Rates | null;
  updatedAt: string | null;
  refresh: () => Promise<void>;
  convert: (amount: number, from: string, to: string) => number;
};

const FxContext = createContext<FxState | null>(null);

export function FxProvider({ children }: { children: React.ReactNode }) {
  const [rates, setRates] = useState<Rates | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await api.fx();
      setRates(r.rates);
      setUpdatedAt(r.updated_at);
    } catch (e) {
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
    <FxContext.Provider value={{ rates, updatedAt, refresh, convert }}>
      {children}
    </FxContext.Provider>
  );
}

export function useFx() {
  const ctx = useContext(FxContext);
  if (!ctx) return { rates: null, updatedAt: null, refresh: async () => {}, convert: (a: number) => a };
  return ctx;
}
