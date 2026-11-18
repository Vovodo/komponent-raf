import type { Section } from '../types';

export const UNASSIGNED_SECTION_FALLBACK: Section = {
  id: 0,
  slug: 'atanmamis',
  name: 'Bölüm Seçilmedi',
  short_code: 'BÖLÜM YOK',
  color_hex: '#64748B',
  emoji: '⬜',
  sort_order: 0,
  item_count: 0,
};

export function getEffectiveSection(
  sec: Section | null | undefined
): Section {
  return sec || UNASSIGNED_SECTION_FALLBACK;
}

export function getContrastText(hexColor: string): '#FFFFFF' | '#0F172A' {
  const clean = hexColor.replace('#', '');
  if (clean.length !== 6) return '#FFFFFF';
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  // Algısal parlaklık hesabı (YIQ)
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 165 ? '#0F172A' : '#FFFFFF';
}

export function hexWithAlpha(hexColor: string, alphaHex: string): string {
  const clean = hexColor.replace('#', '');
  if (clean.length !== 6) return hexColor;
  return `#${clean}${alphaHex}`;
}

export function formatDateTimeTR(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTimeTR(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}
