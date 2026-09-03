export const COLORS = {
  surface: '#FFFFFF',
  onSurface: '#1A1A1A',
  surfaceSecondary: '#F5F5F7',
  onSurfaceSecondary: '#4A4A4A',
  surfaceTertiary: '#EBEBF0',
  onSurfaceTertiary: '#8E8E93',
  surfaceInverse: '#1A1A1A',
  onSurfaceInverse: '#FFFFFF',
  brand: '#4D7358',
  brandSecondary: '#85A38F',
  brandTertiary: '#E3EDE6',
  onBrandTertiary: '#4D7358',
  success: '#4D7358',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#8E8E93',
  border: '#E5E5EA',
  borderStrong: '#C7C7CC',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const RADIUS = { sm: 6, md: 12, lg: 20, pill: 999 };

export const FONT = {
  size: { sm: 12, base: 14, lg: 16, xl: 20, xxl: 24, xxxl: 32, hero: 40 },
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
