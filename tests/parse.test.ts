// SPDX-License-Identifier: AGPL-3.0-or-later
// Unit tests for the dependency-free pipeline parser, canonicalisers and the two
// reconciliation gates — including deliberate failure cases that prove a shifted
// or corrupted column makes a gate fail.
import { describe, expect, it } from 'vitest';
import {
  toNum, propTypeKey, parseQuarter, extractSheet, totalRow,
  reconcileMetroVictoria, reconcileLgaSum, slug, lgaKey, pct,
} from '../pipeline/parse.mjs';

describe('toNum', () => {
  it('parses numbers, strips $ and commas', () => {
    expect(toNum('550')).toBe(550);
    expect(toNum('1,234')).toBe(1234);
    expect(toNum('$300')).toBe(300);
  });
  it('treats "-" and blanks as null (suppressed, not zero)', () => {
    for (const s of ['-', '–', '—', '', 'n/a', 'np', 's']) expect(toNum(s)).toBeNull();
  });
  it('returns null for non-numeric junk', () => { expect(toNum('abc')).toBeNull(); });
});

describe('propTypeKey', () => {
  it('resolves both suburb and LGA sheet spellings', () => {
    expect(propTypeKey('2 bedroom house')).toBe('2bh');
    expect(propTypeKey('2br House')).toBe('2bh');
    expect(propTypeKey('All properties')).toBe('all');
    expect(propTypeKey('All Properties')).toBe('all');
  });
  it('returns null for unknown sheets', () => { expect(propTypeKey('Notes')).toBeNull(); });
});

describe('parseQuarter', () => {
  it('parses month-year labels to sortable keys', () => {
    expect(parseQuarter('Sep 2025')).toMatchObject({ key: '2025Q3', y: 2025, q: 3 });
    expect(parseQuarter('Jun 1999')).toMatchObject({ key: '1999Q2', y: 1999, q: 2 });
    expect(parseQuarter('December 2020')).toMatchObject({ key: '2020Q4', q: 4 });
  });
  it('orders chronologically', () => {
    expect(parseQuarter('Mar 2001')!.order).toBeGreaterThan(parseQuarter('Dec 2000')!.order);
  });
  it('rejects non-quarter text', () => { expect(parseQuarter('Total')).toBeNull(); });
});

describe('name helpers', () => {
  it('slugifies', () => { expect(slug("Albert Park-Middle Park")).toBe('albert-park-middle-park'); });
  it('joins DFFH LGA labels to ABS names by key (drops any suffix)', () => {
    expect(lgaKey('Bayside')).toBe(lgaKey('Bayside (Vic.)'));
    expect(lgaKey('Latrobe')).toBe(lgaKey('Latrobe (Vic.)'));
    expect(lgaKey("Mornington Penin'a")).toBe(lgaKey('Mornington Peninsula (S)'));
    expect(lgaKey('Colac-Otway')).toBe(lgaKey('Colac Otway (S)'));
  });
});

describe('pct', () => {
  it('computes percent change and guards divide-by-zero', () => {
    expect(pct(150, 100)).toBeCloseTo(50);
    expect(pct(100, 0)).toBeNull();
    expect(pct(null, 100)).toBeNull();
  });
});

/* ── a synthetic LGA "All properties" sheet mirroring the real layout ── */
// cols: [region, name, Count, Median, Count, Median] for two quarters.
function makeSheet(rows: any[][]) {
  return extractSheet([
    ['title'],
    ['All Properties', '', 'Mar 2020', 'Mar 2020', 'Jun 2020', 'Jun 2020'],
    ['', '', 'Count', 'Median', 'Count', 'Median'],
    ...rows,
  ]);
}
const GOOD = () => makeSheet([
  ['North', 'Alpha', 100, 400, 110, 420],
  ['', 'Beta', 50, 350, 55, 360],
  ['METRO NON-METRO', 'Metro', 120, 410, 130, 430],
  ['', 'Non-Metro', 30, 300, 35, 310],
  ['', 'Victoria', 150, 400, 165, 415],
]);

describe('extractSheet', () => {
  it('reads quarters, region fill-down, place names and (count, median) pairs', () => {
    const sh = GOOD();
    expect(sh.quarters.map((q: any) => q.key)).toEqual(['2020Q1', '2020Q2']);
    const beta = sh.records.find((r: any) => r.name === 'Beta')!;
    expect(beta.region).toBe('North'); // filled down from Alpha's row
    expect(beta.count).toEqual([50, 55]);
    expect(beta.median).toEqual([350, 360]);
    expect(sh.records.find((r: any) => r.name === 'Victoria')!.isTotal).toBe(true);
    expect(beta.isTotal).toBe(false);
  });
  it('coerces "-" cells to null', () => {
    const sh = makeSheet([['R', 'Gamma', '-', '-', 5, 90], ['', 'Victoria', 5, 90, 5, 90]]);
    const gamma = sh.records.find((r: any) => r.name === 'Gamma')!;
    expect(gamma.count[0]).toBeNull();
    expect(gamma.count[1]).toBe(5);
  });
});

describe('GATE 1 — Metro + Non-Metro == Victoria', () => {
  it('passes on well-formed data', () => {
    const g = reconcileMetroVictoria(GOOD());
    expect(g.ok).toBe(true);
    expect(g.checked).toBe(2);
  });
  it('FAILS when a count column is shifted by one (the whole point of the gate)', () => {
    // Corrupt Victoria's second-quarter count so metro+nonmetro no longer matches.
    const sh = GOOD();
    totalRow(sh, 'Victoria')!.count[1] = 999;
    const g = reconcileMetroVictoria(sh);
    expect(g.ok).toBe(false);
    expect(g.mismatches[0]).toMatchObject({ quarter: '2020Q2', got: 165, victoria: 999 });
  });
  it('reports missing total rows rather than silently passing', () => {
    const sh = makeSheet([['R', 'Alpha', 1, 1, 1, 1]]);
    expect(reconcileMetroVictoria(sh).ok).toBe(false);
  });
});

describe('GATE 2 — Σ(individual LGAs) == Victoria', () => {
  it('passes when member LGAs sum to the Victoria total', () => {
    const g = reconcileLgaSum(GOOD()); // Alpha+Beta = 150/165 = Victoria
    expect(g.ok).toBe(true);
    expect(g.checked).toBe(2);
  });
  it('FAILS when an LGA value is corrupted', () => {
    const sh = GOOD();
    sh.records.find((r: any) => r.name === 'Alpha')!.count[0] = 12345;
    expect(reconcileLgaSum(sh).ok).toBe(false);
  });
  it('skips quarters where a member is suppressed (sum is only a lower bound)', () => {
    const sh = makeSheet([
      ['R', 'Alpha', '-', 400, 110, 420],
      ['', 'Beta', 50, 350, 55, 360],
      ['METRO NON-METRO', 'Metro', 120, 410, 130, 430],
      ['', 'Non-Metro', 30, 300, 35, 310],
      ['', 'Victoria', 150, 400, 165, 415],
    ]);
    const g = reconcileLgaSum(sh);
    expect(g.checked).toBe(1); // only Q2 (Q1 has a suppressed member)
    expect(g.ok).toBe(true);
  });
});
