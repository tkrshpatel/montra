export type Palette = {
  // Surfaces
  surface: string;
  surfaceSecondary: string;
  surfaceTertiary: string;
  surfaceElevated: string;
  surfaceInverse: string;
  // On-surface (text)
  onSurface: string;
  onSurfaceSecondary: string;
  onSurfaceTertiary: string;
  onSurfaceInverse: string;
  // Brand
  brand: string;
  brandSecondary: string;
  brandTertiary: string;
  onBrandTertiary: string;
  onBrand: string;
  // Signal
  success: string;
  warning: string;
  error: string;
  info: string;
  // Structure
  border: string;
  borderStrong: string;
  // Hero overlay
  heroOverlayTop: string;
  heroOverlayBottom: string;
  // Shadows (rgba strings)
  shadow: string;
  // Tinted screen background (for hero-like screens)
  tintedBg: string;
};

export const LIGHT: Palette = {
  surface: '#FFFFFF',
  surfaceSecondary: '#F5F5F7',
  surfaceTertiary: '#EBEBF0',
  surfaceElevated: '#FFFFFF',
  surfaceInverse: '#0B0B0F',

  onSurface: '#0B0B0F',
  onSurfaceSecondary: '#4A4A55',
  onSurfaceTertiary: '#8E8E96',
  onSurfaceInverse: '#FFFFFF',

  brand: '#3F6B4C',
  brandSecondary: '#7CA189',
  brandTertiary: '#E3EDE6',
  onBrandTertiary: '#3F6B4C',
  onBrand: '#FFFFFF',

  success: '#3F6B4C',
  warning: '#FF9500',
  error: '#FF3B30',
  info: '#8E8E93',

  border: '#E5E5EA',
  borderStrong: '#C7C7CC',

  heroOverlayTop: 'rgba(11,11,15,0.30)',
  heroOverlayBottom: 'rgba(11,11,15,0.82)',

  shadow: 'rgba(11,11,15,0.08)',
  tintedBg: '#F0F5F1',
};

export const DARK: Palette = {
  surface: '#0B0B10',
  surfaceSecondary: '#17171E',
  surfaceTertiary: '#22222B',
  surfaceElevated: '#1B1B22',
  surfaceInverse: '#FAFAFC',

  onSurface: '#F5F5F7',
  onSurfaceSecondary: '#B4B4BE',
  onSurfaceTertiary: '#7C7C86',
  onSurfaceInverse: '#0B0B10',

  brand: '#8CC79B',
  brandSecondary: '#5D8B6A',
  brandTertiary: '#1C2C22',
  onBrandTertiary: '#8CC79B',
  onBrand: '#0B0B10',

  success: '#8CC79B',
  warning: '#FFB554',
  error: '#FF6B6B',
  info: '#7C7C86',

  border: '#26262E',
  borderStrong: '#3A3A44',

  heroOverlayTop: 'rgba(0,0,0,0.35)',
  heroOverlayBottom: 'rgba(0,0,0,0.90)',

  shadow: 'rgba(0,0,0,0.45)',
  tintedBg: '#101319',
};
