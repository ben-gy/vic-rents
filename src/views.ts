// SPDX-License-Identifier: AGPL-3.0-or-later
// All non-map views for Victorian Rents. Each takes (container, state) and wires
// its own interactivity. Every data mark carries a [data-tip] tooltip.
import {
  type Meta, type Places, type Place, type Series,
  TYPE_COLOR, fmtMoney, fmtMoneyWk, fmtNum, fmtPct,
  current, currentCount, changeOver, displayMedian, toReal, pctChange, lastIdx, firstIdx,
  changeColor, levelColor,
} from './data';
import { lineChart, barsH, sparkline, makeBins, histogram, heatmap, esc, tip, type BarItem } from './charts';
import { squarify } from './utils/squarify';
import { attachSvgZoom } from './utils/svgZoom';
import { withGlossary } from './glossary';

export interface AppState {
  meta: Meta;
  places: Places;
  typeKey: string;
  real: boolean;
  openPlace: (kind: 'suburb' | 'lga', slug: string) => void;
  setHash: (h: string) => void;
}

const g = withGlossary;
const dispMed = (p: Place, st: AppState): (number | null)[] => displayMedian(p.types[st.typeKey], st.real, st.meta.cpi);
const typeLabel = (st: AppState, k = st.typeKey): string => st.meta.propTypes.find((t) => t.key === k)?.short ?? k;
const realTag = (st: AppState): string => (st.real ? ' <span class="real-tag">real $</span>' : '');

/* ════════════════════════════ OVERVIEW ════════════════════════════ */
export function overview(el: HTMLElement, st: AppState): void {
  const { meta } = st;
  const h = meta.headline;
  const vic = meta.victoria.all;
  const disp = displayMedian(vic, st.real, meta.cpi);
  const now = disp[lastIdx(vic.median)] ?? h.medianNow;
  const start = disp[firstIdx(vic.median)] ?? h.medianStart;
  const mult = start ? now / start : 0;
  const realMult = h.cpiChangePct != null ? (h.medianNow / h.medianStart) / (1 + h.cpiChangePct / 100) : null;

  // COVID band + GST/COVID markers
  const idxOf = (key: string) => meta.quarters.findIndex((q) => q.key === key);
  const bands = [{ from: idxOf('2020Q1'), to: idxOf('2021Q3'), label: 'COVID', color: 'rgba(148,163,184,0.18)' }].filter((b) => b.from >= 0);
  const markers = [
    { idx: idxOf('2000Q3'), label: 'GST' },
    { idx: idxOf('2022Q1'), label: 'rents surge' },
  ].filter((m) => m.idx >= 0);

  const line = lineChart({
    quarters: meta.quarters,
    series: [{ label: `Victoria median${st.real ? ' (real)' : ''}`, color: TYPE_COLOR.all, values: disp }],
    bands, markers, height: 360,
    yFormat: (v) => '$' + Math.round(v),
    tipFormat: (v) => fmtMoneyWk(v),
  });

  const typeBars = barsH(
    meta.propTypes.filter((t) => t.key !== 'all').map((t) => {
      const v = displayMedian(meta.victoria[t.key], st.real, meta.cpi)[lastIdx(meta.victoria[t.key].median)];
      return { label: t.short, value: v ?? 0, color: TYPE_COLOR[t.key], tip: `${t.label}: ${fmtMoneyWk(v)} (Victoria median, ${meta.generatedFor})` };
    }),
    { valueFormat: (v) => '$' + Math.round(v) },
  );

  el.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <div class="hero-kicker">Victoria · median weekly rent · all properties${realTag(st)}</div>
        <div class="hero-figure">${fmtMoneyWk(now)}</div>
        <p class="hero-line">The typical new lease in Victoria costs <strong>${fmtMoney(now)} a week</strong> — <strong>${mult.toFixed(1)}×</strong> the ${fmtMoney(start)} it cost in ${esc(h.sinceLabel)} ${st.real ? '(both in today\'s dollars)' : `(${fmtPct(h.pctChange)})`}.
        ${realMult != null && !st.real ? `Even after inflation, that's a <strong>${((realMult - 1) * 100).toFixed(0)}% real rise</strong> — rents outran the cost of living.` : ''}</p>
        <p class="hero-note">${g('Median', 'median rent')} of ${g('new lettings', 'new lettings')} from the Victorian Government's Rental Report. Latest quarter: ${esc(h.latestLabel)}.</p>
      </div>
    </section>

    <div class="tiles">
      ${tile('Dearest council', h.dearestLga.name, fmtMoneyWk(h.dearestLga.now), 'lga', h.dearestLga.slug)}
      ${tile('Most affordable council', h.cheapestLga.name, fmtMoneyWk(h.cheapestLga.now), 'lga', h.cheapestLga.slug)}
      ${tile('Biggest all-time riser', h.biggestRiserLga.name, fmtPct(h.biggestRiserLga.ch.pct) + ' since ' + h.biggestRiserLga.ch.from, 'lga', h.biggestRiserLga.slug)}
      ${tile('New lettings a quarter', 'across Victoria', fmtNum(h.lettingsNow), '', '')}
    </div>

    <div class="panel">
      <div class="panel-head"><h2>The 26-year climb</h2><p>Median weekly rent for all properties across Victoria, every quarter since ${esc(meta.dataStart)}.${st.real ? ' Shown in today\'s dollars.' : ' Use the “real $” toggle in the header to adjust for inflation.'}</p></div>
      <div class="chart-wrap">${line}</div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-head"><h3>What each dwelling costs now</h3><p>Victoria median, ${esc(meta.generatedFor)}${st.real ? ' · real $' : ''}.</p></div>
        <div class="chart-wrap">${typeBars}</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>${g('Metro', 'metro')} vs regional</h3><p>Median weekly rent, all properties, ${esc(meta.generatedFor)}.</p></div>
        <div class="split-stat">
          <div><span class="ss-k">Metropolitan Melbourne</span><span class="ss-v">${fmtMoneyWk(realNow(meta.metro, st))}</span></div>
          <div><span class="ss-k">Regional Victoria</span><span class="ss-v">${fmtMoneyWk(realNow(meta.nonMetro, st))}</span></div>
          <div><span class="ss-k">Gap</span><span class="ss-v">${fmtMoneyWk((realNow(meta.metro, st) ?? 0) - (realNow(meta.nonMetro, st) ?? 0))}</span></div>
        </div>
        <p class="mini-note">Regional rents were far cheaper for two decades, then closed much of the gap after 2020 as movers left the city. See <a href="#regions" class="xlink">Metro vs regional</a>.</p>
      </div>
    </div>`;

  el.querySelectorAll<HTMLElement>('[data-open]').forEach((n) => n.addEventListener('click', () => {
    const [kind, slug] = n.dataset.open!.split(':');
    st.openPlace(kind as 'suburb' | 'lga', slug);
  }));
}
const realNow = (s: Series | null, st: AppState): number | null =>
  !s ? null : (st.real ? toReal(s.median, st.meta.cpi) : s.median)[lastIdx(s.median)] ?? null;
function tile(k: string, name: string, v: string, kind: string, slug: string): string {
  const open = kind && slug ? ` data-open="${kind}:${slug}" role="button" tabindex="0"` : '';
  return `<div class="tile${kind ? ' clickable' : ''}"${open}><div class="tile-k">${esc(k)}</div><div class="tile-name">${esc(name)}</div><div class="tile-v">${esc(v)}</div></div>`;
}

/* ════════════════════════════ SUBURB FINDER ════════════════════════════ */
let finderSel: string[] = [];
let finderRebase = false;
export function finder(el: HTMLElement, st: AppState): void {
  const all = [...st.places.suburbs.map((p) => ({ p, kind: 'suburb' as const })), ...st.places.lgas.map((p) => ({ p, kind: 'lga' as const }))];
  const keyOf = (kind: 'suburb' | 'lga', slug: string): string => `${kind}:${slug}`;
  if (!finderSel.length) {
    const want: [('suburb' | 'lga'), string][] = [['lga', 'melbourne'], ['lga', 'greater-geelong'], ['lga', 'ballarat']];
    const pick = want.filter(([k, s]) => all.some((a) => a.kind === k && a.p.slug === s)).map(([k, s]) => keyOf(k, s));
    finderSel = pick.length ? pick : all.slice(0, 3).map((a) => keyOf(a.kind, a.p.slug));
  }
  el.innerHTML = `
    <div class="view-head"><h2>Look up a suburb or council</h2>
      <p class="view-sub">Search any Victorian suburb, town or council and chart what it cost to rent — ${g('by property type', 'property type')} — right back to ${esc(st.meta.dataStart)}. Add several to compare. Change the property type in the header.</p></div>
    <div class="finder-search">
      <input type="search" id="finder-input" placeholder="Type a suburb, town or council…" autocomplete="off" aria-label="Search places" />
      <div class="finder-suggest" id="finder-suggest" role="listbox"></div>
    </div>
    <div class="finder-chips" id="finder-chips"></div>
    <div class="finder-toolbar">
      <label class="switch"><input type="checkbox" id="rebase-toggle" ${finderRebase ? 'checked' : ''}/> <span>Rebase to 100 (compare growth)</span></label>
    </div>
    <div class="panel"><div class="chart-wrap" id="finder-chart"></div></div>
    <div class="panel"><div class="table-scroll"><table class="data-table" id="finder-table"></table></div></div>`;

  const input = el.querySelector('#finder-input') as HTMLInputElement;
  const suggest = el.querySelector('#finder-suggest') as HTMLElement;
  let debounce: number;
  const renderSuggest = (qstr: string) => {
    const s = qstr.trim().toLowerCase();
    if (!s) { suggest.innerHTML = ''; suggest.classList.remove('open'); return; }
    const matches = all.filter((a) => a.p.name.toLowerCase().includes(s)).slice(0, 10);
    suggest.innerHTML = matches.map((a) => `<div class="sg-item" role="option" data-key="${key(a.kind, a.p.slug)}"><span>${esc(a.p.name)}</span><span class="sg-kind">${a.kind === 'lga' ? 'council' : esc(a.p.region)}</span></div>`).join('') || '<div class="sg-empty">No match</div>';
    suggest.classList.add('open');
  };
  input.addEventListener('input', () => { clearTimeout(debounce); debounce = window.setTimeout(() => renderSuggest(input.value), 200); });
  input.addEventListener('focus', () => renderSuggest(input.value));
  suggest.addEventListener('click', (e) => {
    const item = (e.target as Element).closest('.sg-item') as HTMLElement;
    if (!item) return;
    if (!finderSel.includes(item.dataset.key!) && finderSel.length < 8) finderSel.push(item.dataset.key!);
    input.value = ''; suggest.innerHTML = ''; suggest.classList.remove('open');
    draw();
  });
  document.addEventListener('click', (e) => { if (!el.querySelector('.finder-search')?.contains(e.target as Node)) suggest.classList.remove('open'); });
  (el.querySelector('#rebase-toggle') as HTMLInputElement).addEventListener('change', (e) => { finderRebase = (e.target as HTMLInputElement).checked; draw(); });

  function key(kind: 'suburb' | 'lga', slug: string): string { return `${kind}:${slug}`; }
  function resolve(k: string): { kind: 'suburb' | 'lga'; p: Place } | null {
    const [kind, slug] = k.split(':');
    const list = kind === 'lga' ? st.places.lgas : st.places.suburbs;
    const p = list.find((x) => x.slug === slug);
    return p ? { kind: kind as 'suburb' | 'lga', p } : null;
  }
  function draw(): void {
    const sel = finderSel.map(resolve).filter(Boolean) as { kind: 'suburb' | 'lga'; p: Place }[];
    // chips
    const chips = el.querySelector('#finder-chips')!;
    const palette = ['#0f766e', '#ea580c', '#6366f1', '#dc2626', '#0ea5e9', '#a16207', '#16a34a', '#db2777'];
    chips.innerHTML = sel.map((s, i) => `<span class="chip" style="--c:${palette[i % palette.length]}"><i></i>${esc(s.p.name)}<button data-rm="${key(s.kind, s.p.slug)}" aria-label="Remove ${esc(s.p.name)}">×</button></span>`).join('') || '<span class="muted">Add a place above to start.</span>';
    chips.querySelectorAll<HTMLButtonElement>('button[data-rm]').forEach((b) => b.addEventListener('click', () => { finderSel = finderSel.filter((k) => k !== b.dataset.rm); draw(); }));

    const series = sel.map((s, i) => {
      let vals = dispMed(s.p, st);
      if (finderRebase) { const fi = firstIdx(vals); const base = fi >= 0 ? vals[fi] : null; vals = base ? vals.map((v) => (v == null ? null : (v / base) * 100)) : vals; }
      return { label: s.p.name, color: palette[i % palette.length], values: vals };
    });
    el.querySelector('#finder-chart')!.innerHTML = series.length
      ? lineChart({ quarters: st.meta.quarters, series, height: 380, yFormat: (v) => (finderRebase ? String(Math.round(v)) : '$' + Math.round(v)), tipFormat: (v) => (v == null ? '—' : finderRebase ? Math.round(v) + ' (=100 at start)' : fmtMoneyWk(v)) })
      : '<p class="empty">Search for a place to chart its rent history.</p>';

    // table
    const tbl = el.querySelector('#finder-table') as HTMLTableElement;
    tbl.innerHTML = `<thead><tr><th>Place</th><th class="num">Now${st.real ? ' (real)' : ''}</th><th class="num">1yr</th><th class="num">5yr</th><th class="num">Since ${esc(st.meta.dataStart)}</th><th class="num">Lettings/qtr</th></tr></thead><tbody>${
      sel.map((s) => {
        const md = s.p.types[st.typeKey];
        const now = md ? current(md) : null;
        return `<tr class="clickable" data-open="${key(s.kind, s.p.slug)}"><td>${esc(s.p.name)} <span class="kind-tag">${s.kind === 'lga' ? 'council' : 'suburb'}</span></td><td class="num mono">${fmtMoneyWk(now)}</td>${chgCell(md, 4)}${chgCell(md, 20)}${chgCell(md, 0)}<td class="num mono">${fmtNum(md ? currentCount(md) : null)}</td></tr>`;
      }).join('')
    }</tbody>`;
    tbl.querySelectorAll<HTMLElement>('[data-open]').forEach((r) => r.addEventListener('click', () => { const [k, sl] = r.dataset.open!.split(':'); st.openPlace(k as any, sl); }));
  }
  draw();
}
function chgCell(s: Series | undefined, ago: number): string {
  const v = changeOver(s, ago);
  return `<td class="num mono" style="color:${v == null ? 'var(--text-tertiary)' : v > 3 ? '#c2410c' : v < -3 ? '#15803d' : 'var(--text-secondary)'}">${fmtPct(v)}</td>`;
}

/* ════════════════════════════ RISERS & FALLERS ════════════════════════════ */
let moversScope: 'lga' | 'suburb' = 'lga';
let moversWin = 20;
export function movers(el: HTMLElement, st: AppState): void {
  const wins = [{ v: 4, l: '1 year' }, { v: 20, l: '5 years' }, { v: 0, l: 'All-time' }];
  el.innerHTML = `
    <div class="view-head"><h2>Risers &amp; fallers</h2>
    <p class="view-sub">Where rents climbed fastest — and the rare places they fell. ${g('Median', 'median rent')} change for ${typeLabel(st).toLowerCase()}, over your chosen window. Click any bar for the full history.</p></div>
    <div class="toolbar">
      <div class="seg-group" id="mv-scope">${(['lga', 'suburb'] as const).map((s) => `<button class="seg${moversScope === s ? ' active' : ''}" data-scope="${s}">${s === 'lga' ? 'Councils' : 'Suburbs'}</button>`).join('')}</div>
      <div class="seg-group" id="mv-win">${wins.map((w) => `<button class="seg${moversWin === w.v ? ' active' : ''}" data-win="${w.v}">${w.l}</button>`).join('')}</div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>Fastest rising</h3></div><div class="chart-wrap" id="mv-up"></div></div>
      <div class="panel"><div class="panel-head"><h3>Falling &amp; slowest-growing</h3></div><div class="chart-wrap" id="mv-down"></div></div>
    </div>`;
  const wire = (id: string, attr: string, cb: (v: string) => void) => el.querySelector(id)!.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { cb(b.dataset[attr]!); movers(el, st); }));
  wire('#mv-scope', 'scope', (v) => (moversScope = v as any));
  wire('#mv-win', 'win', (v) => (moversWin = Number(v)));

  const list = moversScope === 'lga' ? st.places.lgas : st.places.suburbs;
  const rows = list.map((p) => ({ p, pct: changeOver(p.types[st.typeKey], moversWin), now: current(p.types[st.typeKey]) }))
    .filter((r) => r.pct != null && r.now != null && (currentCount(r.p.types[st.typeKey]) ?? 0) >= 10);
  rows.sort((a, b) => b.pct! - a.pct!);
  const top = rows.slice(0, 15);
  const bottom = rows.slice(-15).reverse();
  const toBar = (r: { p: Place; pct: number | null; now: number | null }): BarItem => ({
    label: r.p.name, value: Math.round(r.pct!), color: changeColor(r.pct), slug: key(moversScope, r.p.slug),
    tip: `${r.p.name}\n${typeLabel(st)}: ${fmtPct(r.pct)} over ${wins.find((w) => w.v === moversWin)!.l.toLowerCase()}\nNow ${fmtMoneyWk(r.now)}`,
  });
  el.querySelector('#mv-up')!.innerHTML = top.length ? barsH(top.map(toBar), { diverging: false, valueFormat: (v) => fmtPct(v) }) : '<p class="empty">Not enough data.</p>';
  el.querySelector('#mv-down')!.innerHTML = bottom.length ? barsH(bottom.map(toBar), { diverging: true, valueFormat: (v) => fmtPct(v) }) : '<p class="empty">Not enough data.</p>';
  wireBars(el, st);
}
function key(kind: string, slug: string): string { return `${kind}:${slug}`; }
function wireBars(el: HTMLElement, st: AppState): void {
  el.querySelectorAll<HTMLElement>('.bar-row[data-slug]').forEach((n) => n.addEventListener('click', () => { const [k, s] = n.dataset.slug!.split(':'); st.openPlace(k as any, s); }));
}

/* ════════════════════════════ PROPERTY TYPES ════════════════════════════ */
export function types(el: HTMLElement, st: AppState): void {
  const { meta } = st;
  const series = meta.propTypes.filter((t) => t.key !== 'all').map((t) => ({
    label: t.short, color: TYPE_COLOR[t.key], values: displayMedian(meta.victoria[t.key], st.real, meta.cpi),
  }));
  const line = lineChart({ quarters: meta.quarters, series, height: 380, yFormat: (v) => '$' + Math.round(v), tipFormat: (v) => fmtMoneyWk(v) });

  // region × type heatmap (typical council rent per region)
  const regions = meta.regions.lga;
  const cols = meta.propTypes.filter((t) => t.key !== 'all');
  const cellVal = (ri: number, ci: number): number | null => {
    const region = regions[ri]; const tk = cols[ci].key;
    const vals = st.places.lgas.filter((l) => l.region === region).map((l) => current(l.types[tk])).filter((v) => v != null) as number[];
    if (!vals.length) return null;
    vals.sort((a, b) => a - b);
    return vals[Math.floor(vals.length / 2)];
  };
  let vmin = Infinity, vmax = -Infinity;
  for (let r = 0; r < regions.length; r++) for (let c = 0; c < cols.length; c++) { const v = cellVal(r, c); if (v != null) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); } }
  const heat = heatmap(regions, cols.map((c) => c.short), (r, c) => {
    const v = cellVal(r, c);
    return { value: v, color: v == null ? '#eef2f5' : levelColor(v, vmin, vmax), tip: `${regions[r]} · ${cols[c].label}\nTypical council median: ${fmtMoneyWk(v)}` };
  }, { cellText: (v) => (v == null ? '—' : '$' + Math.round(v)) });

  el.innerHTML = `
    <div class="view-head"><h2>By property type</h2>
    <p class="view-sub">Houses cost more than flats, and the gap has widened. Victoria-wide median weekly rent for each dwelling type over time, and the typical rent in each region now.</p></div>
    <div class="panel"><div class="panel-head"><h3>Six dwellings, 26 years${realTag(st)}</h3><p>Victoria median weekly rent by ${g('property type', 'property type')}.</p></div><div class="chart-wrap">${line}</div></div>
    <div class="panel"><div class="panel-head"><h3>Typical rent by region &amp; dwelling · ${esc(meta.generatedFor)}</h3><p>Median of council medians within each region. Deeper = dearer.</p></div><div class="chart-scroll">${heat}</div></div>`;
}

/* ════════════════════════════ METRO vs REGIONAL ════════════════════════════ */
export function regions(el: HTMLElement, st: AppState): void {
  const { meta } = st;
  const metro = meta.metro, non = meta.nonMetro;
  const line = lineChart({
    quarters: meta.quarters,
    series: [
      { label: 'Metropolitan Melbourne', color: '#0f766e', values: metro ? displayMedian(metro, st.real, meta.cpi) : [] },
      { label: 'Regional Victoria', color: '#ea580c', values: non ? displayMedian(non, st.real, meta.cpi) : [] },
    ],
    height: 360, yFormat: (v) => '$' + Math.round(v), tipFormat: (v) => fmtMoneyWk(v),
  });
  // ratio line
  const ratio = meta.quarters.map((_, i) => { const m = metro?.median[i]; const n = non?.median[i]; return m != null && n != null && n ? (m / n - 1) * 100 : null; });
  const ratioLine = lineChart({ quarters: meta.quarters, series: [{ label: 'Metro premium over regional', color: '#6366f1', values: ratio }], height: 240, yFormat: (v) => Math.round(v) + '%', tipFormat: (v) => (v == null ? '—' : 'Metro ' + fmtPct(v) + ' vs regional') });

  // treemap of councils by lettings (all properties), coloured by rent level
  const lgas = st.places.lgas.map((l) => ({ l, lett: currentCount(l.types.all) ?? 0, med: current(l.types.all) }))
    .filter((x) => x.lett > 0).sort((a, b) => b.lett - a.lett);
  const W = 960, H = 460;
  const rects = squarify(lgas.map((x) => x.lett), W, H);
  let vmin = Infinity, vmax = -Infinity;
  for (const x of lgas) if (x.med != null) { vmin = Math.min(vmin, x.med); vmax = Math.max(vmax, x.med); }
  const cells = rects.map((r, i) => {
    const x = lgas[i];
    const show = r.w > 46 && r.h > 20;
    return `<g class="tm-cell clickable" data-slug="lga:${x.l.slug}" data-tip="${tip(`${x.l.name}\n${fmtNum(x.lett)} lettings/qtr\nMedian ${fmtMoneyWk(x.med)}`)}">`
      + `<rect x="${r.x.toFixed(1)}" y="${r.y.toFixed(1)}" width="${r.w.toFixed(1)}" height="${r.h.toFixed(1)}" fill="${levelColor(x.med, vmin, vmax)}" stroke="#fff" stroke-width="1"/>`
      + (show ? `<text x="${(r.x + 5).toFixed(1)}" y="${(r.y + 15).toFixed(1)}" class="tm-label">${esc(x.l.name)}</text><text x="${(r.x + 5).toFixed(1)}" y="${(r.y + 29).toFixed(1)}" class="tm-sub">${fmtMoneyWk(x.med)}</text>` : '')
      + `</g>`;
  }).join('');
  const treemap = `<svg viewBox="0 0 ${W} ${H}" class="chart treemap" preserveAspectRatio="xMidYMid meet">${cells}</svg>`;

  el.innerHTML = `
    <div class="view-head"><h2>Metro vs regional</h2>
    <p class="view-sub">The two Victorias. Regional rents were far cheaper for twenty years, then closed much of the gap after 2020 when city renters moved out. Sizes below show where the rental market actually is.</p></div>
    <div class="panel"><div class="panel-head"><h3>${g('Metro', 'metro')} vs regional median${realTag(st)}</h3><p>All properties, quarterly.</p></div><div class="chart-wrap">${line}</div></div>
    <div class="panel"><div class="panel-head"><h3>How much dearer is the city?</h3><p>Metro median as a premium over regional. The gap shrank sharply through the 2020s.</p></div><div class="chart-wrap">${ratioLine}</div></div>
    <div class="panel"><div class="panel-head"><h3>Where the rental market is</h3><p>Every council sized by ${g('new lettings', 'lettings count')} a quarter, shaded by median rent. Click to drill in.</p></div><div class="chart-scroll" id="tm-wrap">${treemap}</div></div>`;
  const svg = el.querySelector('#tm-wrap svg') as SVGSVGElement | null;
  // Guarded: jsdom (used by the render test) doesn't implement SVGSVGElement.viewBox.
  try { if (svg && (svg as any).viewBox?.baseVal) attachSvgZoom(svg); } catch { /* zoom is progressive enhancement */ }
  wireBars(el, st);
  el.querySelectorAll<HTMLElement>('.tm-cell[data-slug]').forEach((n) => n.addEventListener('click', () => { const [k, s] = n.dataset.slug!.split(':'); st.openPlace(k as any, s); }));
}

/* ════════════════════════════ RANKINGS ════════════════════════════ */
let rankScope: 'lga' | 'suburb' = 'lga';
let rankMetric: 'level' | 'chgAll' = 'level';
export function rankings(el: HTMLElement, st: AppState): void {
  el.innerHTML = `
    <div class="view-head"><h2>Leaderboards</h2>
    <p class="view-sub">The dearest and most affordable places to rent ${typeLabel(st).toLowerCase()}, and where it has risen most. Places with very few ${g('lettings', 'lettings count')} are excluded.</p></div>
    <div class="toolbar">
      <div class="seg-group" id="rk-scope">${(['lga', 'suburb'] as const).map((s) => `<button class="seg${rankScope === s ? ' active' : ''}" data-scope="${s}">${s === 'lga' ? 'Councils' : 'Suburbs'}</button>`).join('')}</div>
      <div class="seg-group" id="rk-metric">${([['level', 'Rent now'], ['chgAll', 'Growth since ' + st.meta.dataStart]] as const).map(([m, l]) => `<button class="seg${rankMetric === m ? ' active' : ''}" data-metric="${m}">${l}</button>`).join('')}</div>
    </div>
    <div class="grid-2">
      <div class="panel"><div class="panel-head"><h3>${rankMetric === 'level' ? 'Most expensive' : 'Fastest rising'}</h3></div><div class="chart-wrap" id="rk-top"></div></div>
      <div class="panel"><div class="panel-head"><h3>${rankMetric === 'level' ? 'Most affordable' : 'Slowest / falling'}</h3></div><div class="chart-wrap" id="rk-bot"></div></div>
    </div>`;
  const wire = (id: string, attr: string, cb: (v: string) => void) => el.querySelector(id)!.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { cb(b.dataset[attr]!); rankings(el, st); }));
  wire('#rk-scope', 'scope', (v) => (rankScope = v as any));
  wire('#rk-metric', 'metric', (v) => (rankMetric = v as any));

  const list = rankScope === 'lga' ? st.places.lgas : st.places.suburbs;
  const vicNow = current(st.meta.victoria[st.typeKey]);
  const rows = list.map((p) => ({ p, level: current(p.types[st.typeKey]), chg: changeOver(p.types[st.typeKey], 0), lett: currentCount(p.types[st.typeKey]) ?? 0 }))
    .filter((r) => (rankMetric === 'level' ? r.level != null : r.chg != null) && r.lett >= 15);
  const val = (r: any) => (rankMetric === 'level' ? r.level : r.chg);
  rows.sort((a, b) => val(b) - val(a));
  const fmt = (v: number) => (rankMetric === 'level' ? '$' + Math.round(v) : fmtPct(v));
  const toBar = (r: any): BarItem => ({
    label: r.p.name, value: Math.round(val(r)), color: rankMetric === 'level' ? levelColor(r.level, 0, current(st.meta.victoria[st.typeKey]) ? current(st.meta.victoria[st.typeKey])! * 2 : 1000) : changeColor(r.chg), slug: key(rankScope, r.p.slug),
    tip: `${r.p.name}\nRent now ${fmtMoneyWk(r.level)} · ${fmtPct(r.chg)} since ${st.meta.dataStart}\n${fmtNum(r.lett)} lettings/qtr${vicNow != null ? `\nVictoria median ${fmtMoneyWk(vicNow)}` : ''}`,
  });
  el.querySelector('#rk-top')!.innerHTML = barsH(rows.slice(0, 15).map(toBar), { valueFormat: fmt });
  el.querySelector('#rk-bot')!.innerHTML = barsH(rows.slice(-15).reverse().map(toBar), { valueFormat: fmt });
  wireBars(el, st);
}

/* ════════════════════════════ EXPLORER ════════════════════════════ */
let expScope: 'lga' | 'suburb' = 'suburb';
let expSort = { col: 'now', dir: -1 };
let expQuery = '';
let expBin: number | null = null;
export function explorer(el: HTMLElement, st: AppState): void {
  el.innerHTML = `
    <div class="view-head"><h2>Explore every place</h2>
    <p class="view-sub">Search, sort and filter every Victorian suburb and council. Figures are ${typeLabel(st).toLowerCase()} — change the property type in the header. Click a row for the full history.</p></div>
    <div class="toolbar">
      <div class="seg-group" id="ex-scope">${(['suburb', 'lga'] as const).map((s) => `<button class="seg${expScope === s ? ' active' : ''}" data-scope="${s}">${s === 'lga' ? 'Councils' : 'Suburbs'}</button>`).join('')}</div>
      <input type="search" id="ex-search" class="ex-search" placeholder="Filter by name…" value="${esc(expQuery)}" aria-label="Filter places"/>
    </div>
    <div class="panel"><div class="panel-head"><h3>Distribution of rent now</h3><p>Click a bar to filter the table to that band.${expBin != null ? ' <button class="clear-btn" id="ex-clear">Clear filter ✕</button>' : ''}</p></div><div class="chart-scroll" id="ex-hist"></div></div>
    <div class="panel"><div class="table-scroll"><table class="data-table" id="ex-table"></table></div></div>`;

  const searchEl = el.querySelector('#ex-search') as HTMLInputElement;
  let deb: number;
  searchEl.addEventListener('input', () => { clearTimeout(deb); deb = window.setTimeout(() => { expQuery = searchEl.value; expBin = null; renderTable(); renderHist(); }, 200); });
  el.querySelector('#ex-scope')!.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => { expScope = b.dataset.scope as any; expBin = null; explorer(el, st); }));
  el.querySelector('#ex-clear')?.addEventListener('click', () => { expBin = null; explorer(el, st); });

  const baseList = () => (expScope === 'lga' ? st.places.lgas : st.places.suburbs)
    .map((p) => ({ p, now: current(p.types[st.typeKey]), c1: changeOver(p.types[st.typeKey], 4), c5: changeOver(p.types[st.typeKey], 20), cAll: changeOver(p.types[st.typeKey], 0), lett: currentCount(p.types[st.typeKey]) }))
    .filter((r) => r.now != null);

  let bins = makeBins(baseList().map((r) => r.now!) as number[], 22);
  function renderHist(): void {
    bins = makeBins(baseList().map((r) => r.now!) as number[], 22);
    el.querySelector('#ex-hist')!.innerHTML = histogram(bins, { labelFormat: (v) => '$' + Math.round(v), activeIdx: expBin, color: TYPE_COLOR[st.typeKey] });
    el.querySelectorAll<HTMLElement>('.hist-bar').forEach((n) => n.addEventListener('click', () => { const i = Number(n.dataset.bin); expBin = expBin === i ? null : i; explorer(el, st); }));
  }
  function renderTable(): void {
    let rows = baseList();
    const q = expQuery.trim().toLowerCase();
    if (q) rows = rows.filter((r) => r.p.name.toLowerCase().includes(q) || r.p.region.toLowerCase().includes(q));
    if (expBin != null && bins[expBin]) { const b = bins[expBin]; rows = rows.filter((r) => r.now! >= b.x0 && (expBin === bins.length - 1 ? r.now! <= b.x1 + 1e-6 : r.now! < b.x1)); }
    const cols: [string, string, (r: any) => number | null][] = [
      ['name', 'Place', () => 0], ['now', `Now`, (r) => r.now], ['c1', '1yr', (r) => r.c1], ['c5', '5yr', (r) => r.c5], ['cAll', 'All', (r) => r.cAll], ['lett', 'Lettings', (r) => r.lett],
    ];
    const sc = cols.find((c) => c[0] === expSort.col)!;
    rows.sort((a, b) => { if (expSort.col === 'name') return a.p.name.localeCompare(b.p.name) * -expSort.dir; const av = sc[2](a) ?? -Infinity, bv = sc[2](b) ?? -Infinity; return (av - bv) * expSort.dir; });
    const tbl = el.querySelector('#ex-table') as HTMLTableElement;
    tbl.innerHTML = `<thead><tr>${cols.map((c) => `<th class="${c[0] === 'name' ? '' : 'num'} sortable${expSort.col === c[0] ? ' sorted' : ''}" data-col="${c[0]}">${c[1]}${expSort.col === c[0] ? (expSort.dir < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('')}<th>Trend</th></tr></thead><tbody>${
      rows.slice(0, 400).map((r) => `<tr class="clickable" data-open="${key(expScope, r.p.slug)}"><td>${esc(r.p.name)}<span class="row-region">${esc(r.p.region)}</span></td><td class="num mono">${fmtMoneyWk(r.now)}</td>${chgCell(r.p.types[st.typeKey], 4)}${chgCell(r.p.types[st.typeKey], 20)}${chgCell(r.p.types[st.typeKey], 0)}<td class="num mono">${fmtNum(r.lett)}</td><td>${sparkline(dispMed(r.p, st), TYPE_COLOR[st.typeKey], 110, 26)}</td></tr>`).join('')
    }</tbody>`;
    tbl.querySelector('thead')!.querySelectorAll<HTMLElement>('th[data-col]').forEach((th) => th.addEventListener('click', () => { const c = th.dataset.col!; if (expSort.col === c) expSort.dir *= -1; else expSort = { col: c, dir: c === 'name' ? 1 : -1 }; renderTable(); }));
    tbl.querySelectorAll<HTMLElement>('[data-open]').forEach((row) => row.addEventListener('click', () => { const [k, s] = row.dataset.open!.split(':'); st.openPlace(k as any, s); }));
    if (rows.length > 400) tbl.insertAdjacentHTML('afterend', '');
  }
  renderHist(); renderTable();
}

/* ════════════════════════════ INSIGHTS ════════════════════════════ */
export function insights(el: HTMLElement, st: AppState): void {
  const { meta } = st;
  const cards: { sev: string; title: string; body: string; slug?: string; kind?: string }[] = [];
  const li = lastIdx(meta.victoria.all.median);

  // real rent
  if (meta.headline.cpiChangePct != null) {
    const realRise = ((meta.headline.medianNow / meta.headline.medianStart) / (1 + meta.headline.cpiChangePct / 100) - 1) * 100;
    cards.push({ sev: realRise > 0 ? 'alert' : 'info', title: 'Rents beat inflation', body: `Since ${meta.dataStart}, the typical Victorian rent rose ${fmtPct(meta.headline.pctChange)} while consumer prices rose ${fmtPct(meta.headline.cpiChangePct)} — a <strong>${realRise.toFixed(0)}% real increase</strong>. Renting takes a bigger bite of income than it did a generation ago.` });
  }
  // biggest riser suburb & council (all-time), min lettings
  for (const [scope, label] of [['lga', 'council'], ['suburb', 'suburb']] as const) {
    const rows = (scope === 'lga' ? st.places.lgas : st.places.suburbs)
      .map((p) => ({ p, chg: changeOver(p.types.all, 0), now: current(p.types.all), lett: currentCount(p.types.all) ?? 0 }))
      .filter((r) => r.chg != null && r.lett >= 20).sort((a, b) => b.chg! - a.chg!);
    if (rows[0]) cards.push({ sev: 'warn', title: `Fastest-rising ${label}`, body: `<strong>${esc(rows[0].p.name)}</strong> rents rose <strong>${fmtPct(rows[0].chg)}</strong> since ${meta.dataStart}, from around ${fmtMoney(rows[0].now! / (1 + rows[0].chg! / 100))} to ${fmtMoneyWk(rows[0].now)} — the steepest of any ${label}.`, slug: rows[0].p.slug, kind: scope });
  }
  // doubled in real terms (suburbs)
  const doubled = st.places.suburbs.map((p) => {
    const real = toReal(p.types.all.median, meta.cpi);
    const fi = firstIdx(real), lii = lastIdx(real);
    const ch = fi >= 0 && lii >= 0 ? pctChange(real[lii], real[fi]) : null;
    return { p, ch, lett: currentCount(p.types.all) ?? 0 };
  }).filter((r) => r.ch != null && r.ch > 100 && r.lett >= 20);
  cards.push({ sev: 'alert', title: 'Doubled even after inflation', body: `<strong>${doubled.length}</strong> suburb${doubled.length === 1 ? '' : 's'} saw real (inflation-adjusted) rents more than <strong>double</strong> since ${meta.dataStart}${doubled.length ? ` — including ${doubled.sort((a, b) => b.ch! - a.ch!).slice(0, 3).map((r) => esc(r.p.name)).join(', ')}` : ''}.` });
  // metro/regional catch-up
  const m0 = meta.metro?.median, n0 = meta.nonMetro?.median;
  if (m0 && n0) {
    const early = meta.quarters.findIndex((q) => q.key === '2019Q4');
    const gapEarly = early >= 0 && m0[early] != null && n0[early] != null ? (m0[early]! / n0[early]! - 1) * 100 : null;
    const gapNow = m0[li] != null && n0[li] != null ? (m0[li]! / n0[li]! - 1) * 100 : null;
    if (gapEarly != null && gapNow != null) cards.push({ sev: 'info', title: 'Regional Victoria caught up', body: `Melbourne rents were <strong>${gapEarly.toFixed(0)}%</strong> above regional Victoria at the end of 2019; today the premium is <strong>${gapNow.toFixed(0)}%</strong>. The pandemic move to the regions narrowed a two-decade gap.` });
  }
  // house vs flat premium widening
  const flat2 = meta.victoria['2bf'].median, house3 = meta.victoria['3bh'].median;
  const prem = (i: number) => (flat2[i] != null && house3[i] != null && flat2[i]! ? (house3[i]! / flat2[i]! - 1) * 100 : null);
  const fi = firstIdx(house3);
  if (prem(li) != null && prem(fi) != null) cards.push({ sev: 'info', title: 'Houses pulled further ahead of flats', body: `A 3-bedroom house now rents for <strong>${prem(li)!.toFixed(0)}%</strong> more than a 2-bedroom flat, up from ${prem(fi)!.toFixed(0)}% in ${meta.quarters[fi].label}. Family housing has become the tighter market.` });

  el.innerHTML = `
    <div class="view-head"><h2>Insights</h2><p class="view-sub">Patterns picked out automatically from 26 years of the Rental Report. Click a place to dig in.</p></div>
    <div class="insight-grid">${cards.map((c) => `<div class="insight ${c.sev}${c.slug ? ' clickable' : ''}"${c.slug ? ` data-open="${c.kind}:${c.slug}" role="button" tabindex="0"` : ''}><div class="insight-title">${esc(c.title)}</div><p>${c.body}</p></div>`).join('')}</div>`;
  el.querySelectorAll<HTMLElement>('[data-open]').forEach((n) => n.addEventListener('click', () => { const [k, s] = n.dataset.open!.split(':'); st.openPlace(k as any, s); }));
}
