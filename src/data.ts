// SPDX-License-Identifier: AGPL-3.0-or-later
// Data model, loaders and shared helpers for Victorian Rents.

export interface Quarter { key: string; label: string; y: number; q: number }
export interface Series { median: (number | null)[]; count: (number | null)[] }
export interface PropType { key: string; label: string; short: string }
export interface Place {
  name: string;
  slug: string;
  region: string;
  key?: string; // LGA join key (LGAs only)
  types: Record<string, Series>;
}
export interface Headline {
  latestLabel: string;
  medianNow: number; medianStart: number; sinceLabel: string; pctChange: number;
  lettingsNow: number; metroNow: number | null; regionalNow: number | null;
  dearestLga: { name: string; slug: string; now: number };
  cheapestLga: { name: string; slug: string; now: number };
  biggestRiserLga: { name: string; slug: string; now: number; ch: { pct: number; from: string } };
  cpiChangePct: number | null;
}
export interface Meta {
  title: string;
  generatedFor: string;
  latestQuarter: string;
  dataStart: string;
  quarters: Quarter[];
  propTypes: PropType[];
  regions: { suburb: string[]; lga: string[] };
  counts: { suburbs: number; lgas: number };
  cpi: (number | null)[];
  victoria: Record<string, Series>;
  metro: Series | null;
  nonMetro: Series | null;
  headline: Headline;
  sources: { name: string; url: string }[];
  license: string;
}
export interface Places { suburbs: Place[]; lgas: Place[] }

export const BASE = import.meta.env.BASE_URL || '/';

let _meta: Meta | null = null;
let _places: Places | null = null;

export async function loadMeta(): Promise<Meta> {
  if (_meta) return _meta;
  const r = await fetch(`${BASE}data/meta.json`);
  if (!r.ok) throw new Error(`Failed to load data (${r.status})`);
  _meta = (await r.json()) as Meta;
  return _meta;
}
export async function loadPlaces(): Promise<Places> {
  if (_places) return _places;
  const r = await fetch(`${BASE}data/places.json`);
  if (!r.ok) throw new Error(`Failed to load places (${r.status})`);
  _places = (await r.json()) as Places;
  return _places;
}
export function metaSync(): Meta { if (!_meta) throw new Error('meta not loaded'); return _meta; }
export function placesSync(): Places { if (!_places) throw new Error('places not loaded'); return _places; }

/* ── property-type colours (consistent across every view) ── */
export const TYPE_COLOR: Record<string, string> = {
  all: '#0f766e', // teal (primary)
  '1bf': '#0ea5e9',
  '2bf': '#6366f1',
  '3bf': '#8b5cf6',
  '2bh': '#f59e0b',
  '3bh': '#ef4444',
  '4bh': '#a16207',
};

/* ── formatting ── */
export const fmtMoney = (v: number | null | undefined): string =>
  v == null ? '—' : '$' + Math.round(v).toLocaleString('en-AU');
export const fmtMoneyWk = (v: number | null | undefined): string => (v == null ? '—' : `${fmtMoney(v)}/wk`);
export const fmtNum = (v: number | null | undefined): string =>
  v == null ? '—' : Math.round(v).toLocaleString('en-AU');
export function fmtPct(v: number | null | undefined, dp = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = (v >= 0 ? '+' : '') + v.toFixed(dp);
  return s.replace('+-0', '0').replace(/^\+0$/, '0') + '%';
}

/* ── series maths ── */
export const lastIdx = (s: (number | null)[]): number => {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] != null) return i;
  return -1;
};
export const firstIdx = (s: (number | null)[]): number => {
  for (let i = 0; i < s.length; i++) if (s[i] != null) return i;
  return -1;
};
export const current = (s?: Series): number | null => {
  if (!s) return null;
  const i = lastIdx(s.median);
  return i < 0 ? null : s.median[i];
};
export const currentCount = (s?: Series): number | null => {
  if (!s) return null;
  const i = lastIdx(s.count);
  return i < 0 ? null : s.count[i];
};
export const pctChange = (a: number | null, b: number | null): number | null =>
  a == null || b == null || b === 0 ? null : ((a - b) / b) * 100;

/** Median value `n` quarters before the latest (n=4 → 1yr, 20 → 5yr). */
export function valueAgo(s: Series, quartersAgo: number): number | null {
  const li = lastIdx(s.median);
  if (li < 0) return null;
  const i = li - quartersAgo;
  return i >= 0 ? s.median[i] : null;
}
/** % change over `quartersAgo` (or since first data point if 0). */
export function changeOver(s: Series | undefined, quartersAgo: number): number | null {
  if (!s) return null;
  const li = lastIdx(s.median);
  if (li < 0) return null;
  const now = s.median[li];
  let then: number | null;
  if (quartersAgo === 0) { const fi = firstIdx(s.median); then = fi < 0 ? null : s.median[fi]; }
  else { const i = li - quartersAgo; then = i >= 0 ? s.median[i] : null; }
  return pctChange(now, then);
}

/** Deflate a nominal median series to real (latest-quarter) dollars via CPI. */
export function toReal(median: (number | null)[], cpi: (number | null)[]): (number | null)[] {
  const li = lastIdx(cpi);
  const base = li < 0 ? null : cpi[li];
  if (base == null) return median.slice();
  return median.map((v, i) => {
    const c = cpi[i];
    return v == null || c == null || c === 0 ? null : (v * base) / c;
  });
}

/** Display median series honouring the nominal/real toggle. */
export function displayMedian(s: Series | undefined, real: boolean, cpi: (number | null)[]): (number | null)[] {
  if (!s) return [];
  return real ? toReal(s.median, cpi) : s.median.slice();
}

/* ── change colour ramps ── */
// Diverging ramp for % change: green (down) → neutral → amber → red (up).
export function changeColor(pct: number | null): string {
  if (pct == null) return 'var(--bg-active)';
  if (pct <= -20) return '#15803d';
  if (pct <= -5) return '#4ade80';
  if (pct < 5) return '#cbd5e1';
  if (pct < 25) return '#fcd34d';
  if (pct < 60) return '#fb923c';
  if (pct < 120) return '#f97316';
  return '#dc2626';
}
// Sequential warm ramp for rent levels ($/wk).
export function levelColor(v: number | null, min: number, max: number): string {
  if (v == null) return 'var(--bg-active)';
  const t = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0.5;
  const stops = ['#f0fdfa', '#99f6e4', '#5eead4', '#2dd4bf', '#f6c453', '#f59e0b', '#ea580c', '#c2410c'];
  const idx = Math.min(stops.length - 1, Math.floor(t * (stops.length - 1)));
  return stops[idx];
}

export const findPlace = (places: Place[], slug: string): Place | undefined => places.find((p) => p.slug === slug);
