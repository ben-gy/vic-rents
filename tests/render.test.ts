// SPDX-License-Identifier: AGPL-3.0-or-later
// Headless render smoke test: renders every non-map view against the REAL built
// data (public/data/*.json) and asserts each produces real marks with no NaN /
// undefined / Infinity leaking into the DOM. Also exercises the drawer body.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { overview, finder, movers, types as typesView, regions, rankings, explorer, insights, type AppState } from '../src/views';
import type { Meta, Places } from '../src/data';

const DATA = join(process.cwd(), 'public', 'data');
const meta = JSON.parse(readFileSync(join(DATA, 'meta.json'), 'utf8')) as Meta;
const places = JSON.parse(readFileSync(join(DATA, 'places.json'), 'utf8')) as Places;

function state(over: Partial<AppState> = {}): AppState {
  return { meta, places, typeKey: 'all', real: false, openPlace: () => {}, setHash: () => {}, ...over };
}
const VIEWS = { overview, finder, movers, types: typesView, regions, rankings, explorer, insights };

function assertClean(html: string, label: string): void {
  expect(html.length, `${label} produced empty output`).toBeGreaterThan(200);
  for (const bad of ['NaN', 'undefined', 'Infinity', '$null', '>null<']) {
    expect(html.includes(bad), `${label} leaked "${bad}"`).toBe(false);
  }
}

describe('committed data integrity', () => {
  it('meta has a long timeline and Victoria series', () => {
    expect(meta.quarters.length).toBeGreaterThan(90);
    expect(meta.victoria.all.median.length).toBe(meta.quarters.length);
    expect(meta.headline.medianNow).toBeGreaterThan(meta.headline.medianStart);
  });
  it('every place series is aligned and finite', () => {
    const N = meta.quarters.length;
    for (const p of [...places.suburbs, ...places.lgas]) {
      for (const k of Object.keys(p.types)) {
        expect(p.types[k].median.length).toBe(N);
        for (const v of p.types[k].median) expect(v == null || Number.isFinite(v)).toBe(true);
      }
    }
  });
  it('has the expected coverage', () => {
    expect(places.suburbs.length).toBeGreaterThan(100);
    expect(places.lgas.length).toBe(79);
  });
});

describe('views render cleanly against real data', () => {
  for (const [name, fn] of Object.entries(VIEWS)) {
    it(`renders "${name}" (all properties, nominal)`, () => {
      const el = document.createElement('div');
      fn(el, state());
      assertClean(el.innerHTML, name);
      expect(el.querySelector('svg, table, .insight'), `${name} has no chart, table or card`).toBeTruthy();
    });
    it(`renders "${name}" (2-bed house, real $)`, () => {
      const el = document.createElement('div');
      fn(el, state({ typeKey: '2bh', real: true }));
      assertClean(el.innerHTML, `${name}/2bh/real`);
    });
  }
});

describe('interaction wiring', () => {
  it('finder default selection charts places and lists a table', () => {
    const el = document.createElement('div');
    finder(el, state());
    expect(el.querySelector('#finder-chart svg')).toBeTruthy();
    expect(el.querySelectorAll('#finder-table tbody tr').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('.chip').length).toBeGreaterThan(0);
  });
  it('explorer builds a histogram and a populated table', () => {
    const el = document.createElement('div');
    explorer(el, state());
    expect(el.querySelectorAll('.hist-bar').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('#ex-table tbody tr').length).toBeGreaterThan(0);
  });
  it('movers ranks with clickable bars', () => {
    const el = document.createElement('div');
    movers(el, state());
    expect(el.querySelectorAll('.bar-row[data-slug]').length).toBeGreaterThan(0);
  });
  it('insights produces cards', () => {
    const el = document.createElement('div');
    insights(el, state());
    expect(el.querySelectorAll('.insight').length).toBeGreaterThan(2);
  });
});
