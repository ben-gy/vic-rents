// SPDX-License-Identifier: AGPL-3.0-or-later
// The house-vs-flat insight card used to hardcode one narrative direction ("N% more
// than ... up from M%"). State-wide 3BR house medians sit BELOW 2BR flat medians today
// — a composition effect, not a data error — so it rendered "-11% more than ... up from
// 10%", reported from a phone as unreadable. The card must now read correctly for every
// sign combination, because public/data is regenerated automatically each quarter.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { insights, type AppState } from '../src/views';
import type { Meta, Places } from '../src/data';

const DATA = join(process.cwd(), 'public', 'data');
const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8')) as Meta;
const places = JSON.parse(readFileSync(join(DATA, 'places.json'), 'utf8')) as Places;

/** Render insights and return the house-vs-flat card as plain text, tags stripped. */
function card(m: Meta): string {
  const el = document.createElement('div');
  const st: AppState = { meta: m, places, typeKey: 'all', real: false, openPlace: () => {}, setHash: () => {} };
  insights(el, st);
  const hit = [...el.querySelectorAll('.insight')]
    .map((n) => (n as HTMLElement).textContent ?? '')
    .filter((t) => t.includes('3-bedroom house') && t.includes('2-bedroom flat'));
  expect(hit.length, 'expected exactly one house-vs-flat insight card').toBe(1);
  return hit[0].replace(/\s+/g, ' ').trim();
}

/** Real meta with the two Victoria series overridden at the first and last quarter. */
function withPremium(thenFlat: number, thenHouse: number, nowFlat: number, nowHouse: number): Meta {
  const m = structuredClone(meta);
  // Mirror views.ts, which anchors on the last non-null quarter of the "all" series.
  const all = m.victoria.all.median;
  const li = all.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);
  const f = m.victoria['2bf'].median, h = m.victoria['3bh'].median;
  f.fill(null as never); h.fill(null as never);
  f[0] = thenFlat; h[0] = thenHouse; f[li] = nowFlat; h[li] = nowHouse;
  return m;
}

describe('house-vs-flat insight card', () => {
  it('never glues a negative sign to a comparative (the reported bug)', () => {
    const t = card(meta);
    expect(t, `card printed a signed percentage: "${t}"`).not.toMatch(/[-−+]\s*\d+(\.\d+)?\s*%/);
    expect(t).not.toMatch(/-\d+(\.\d+)?%\s*(more|less|dearer|cheaper|above|below)/);
  });

  it('states the correct direction against the real committed data', () => {
    // Sep 2025: 3BR house $530/wk, 2BR flat $595/wk -> the house is the CHEAPER side.
    const t = card(meta);
    expect(t).toContain('cheaper');
    expect(t).not.toContain('dearer than a 2-bedroom flat');
    // It fell from +10% (Jun 1999) to -11%, so it must not claim the gap went up.
    expect(t).not.toContain('up from');
    expect(t).toContain('down from');
    // The unsupported market claim the old copy asserted must be gone.
    expect(t).not.toContain('tighter market');
  });

  it.each([
    { name: 'house dearer, gap widening', args: [150, 165, 595, 700] as const, want: ['dearer', 'up from'], deny: ['cheaper'] },
    { name: 'house dearer, gap narrowing', args: [150, 190, 595, 620] as const, want: ['dearer', 'down from'], deny: ['cheaper'] },
    { name: 'house cheaper, gap deepening', args: [150, 140, 610, 500] as const, want: ['cheaper', 'down from'], deny: ['dearer'] },
    { name: 'house cheaper, gap easing', args: [150, 120, 595, 560] as const, want: ['cheaper', 'up from'], deny: ['dearer'] },
    { name: 'sign flip: dearer -> cheaper', args: [150, 165, 595, 530] as const, want: ['cheaper', 'down from', 'dearer'], deny: [] },
    { name: 'sign flip: cheaper -> dearer', args: [150, 145, 595, 650] as const, want: ['dearer', 'up from', 'cheaper'], deny: [] },
    { name: 'level now', args: [150, 165, 595, 597] as const, want: ['roughly level'], deny: ['dearer,'] },
    { name: 'level then', args: [150, 151, 595, 530] as const, want: ['cheaper', 'roughly level'], deny: [] },
    { name: 'level throughout', args: [150, 151, 595, 597] as const, want: ['roughly level', 'little changed'], deny: ['dearer', 'cheaper'] },
  ])('reads correctly: $name', ({ args, want, deny }) => {
    const t = card(withPremium(args[0], args[1], args[2], args[3]));
    expect(t, `bad copy: "${t}"`).not.toMatch(/[-−+]\s*\d+(\.\d+)?\s*%/);
    expect(t).not.toMatch(/\b0%\s*(dearer|cheaper)/);
    for (const w of want) expect(t, `missing "${w}" in: "${t}"`).toContain(w);
    for (const d of deny) expect(t, `unexpected "${d}" in: "${t}"`).not.toContain(d);
  });

  it('quotes the two medians so the counter-intuitive result is checkable', () => {
    const t = card(meta);
    expect(t).toContain('$530/wk');
    expect(t).toContain('$595/wk');
  });
});
