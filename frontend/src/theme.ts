import { LIGHT, DARK, Palette } from './theme/palette';
export { useTheme } from './theme/ThemeContext';
export type { Palette } from './theme/palette';

// Legacy default palette — used only by module-scope styles that haven't been
// migrated yet. New code should use `useTheme()` and `makeStyles(colors)`.
export const COLORS: Palette = LIGHT;
export const DARK_COLORS: Palette = DARK;

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const RADIUS = { sm: 8, md: 14, lg: 24, xl: 28, pill: 999 };

export const FONT = {
  size: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 30, hero: 40 },
};

export const CATEGORIES = [
  { key: 'Food', icon: 'coffee', color: '#FF9500' },
  { key: 'Groceries', icon: 'shopping-bag', color: '#4D7358' },
  { key: 'Transport', icon: 'truck', color: '#5AC8FA' },
  { key: 'Shopping', icon: 'shopping-cart', color: '#AF52DE' },
  { key: 'Bills', icon: 'file-text', color: '#FF3B30' },
  { key: 'Entertainment', icon: 'film', color: '#FF2D55' },
  { key: 'Travel', icon: 'map', color: '#007AFF' },
  { key: 'Health', icon: 'heart', color: '#34C759' },
  { key: 'Other', icon: 'more-horizontal', color: '#8E8E93' },
];

export function categoryMeta(name?: string | null) {
  return CATEGORIES.find(c => c.key === name) || CATEGORIES[CATEGORIES.length - 1];
}

export const CURRENCIES = ['USD', 'INR', 'EUR', 'GBP', 'JPY'] as const;
export type CurrencyCode = typeof CURRENCIES[number];

export function currencySymbol(cur?: string | null) {
  const c = (cur || 'USD').toUpperCase();
  if (c === 'INR') return '\u20B9';
  if (c === 'USD') return '$';
  if (c === 'EUR') return '\u20AC';
  if (c === 'GBP') return '\u00A3';
  if (c === 'JPY') return '\u00A5';
  return c + ' ';
}

// Common elevation preset for cards
export function elevation(colors: Palette) {
  return {
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 4,
  };
}
