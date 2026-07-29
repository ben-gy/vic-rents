// SPDX-License-Identifier: AGPL-3.0-or-later
import './style.css';
import {
  loadMeta, loadPlaces, metaSync, placesSync, type Place,
  TYPE_COLOR, fmtMoneyWk, fmtNum, fmtPct, current, currentCount, changeOver, displayMedian,
} from './data';
import { initTooltip } from './components/tooltip';
import { lineChart, esc } from './charts';
import { overview, finder, movers, types as typesView, regions, rankings, explorer, insights, type AppState } from './views';
import { renderMapView, destroyMap } from './map';
import { GLOSSARY } from './glossary';

const VIEWS: { key: string; label: string; render: (el: HTMLElement, st: AppState) => void | Promise<void> }[] = [
  { key: 'overview', label: 'Overview', render: overview },
  { key: 'map', label: 'Map', render: (el, st) => renderMapView(el, { meta: st.meta, places: st.places, typeKey: st.typeKey }, (slug) => st.openPlace('lga', slug)) },
  { key: 'finder', label: 'Suburb finder', render: finder },
  { key: 'movers', label: 'Risers & fallers', render: movers },
  { key: 'types', label: 'Property types', render: typesView },
  { key: 'regions', label: 'Metro vs regional', render: regions },
  { key: 'rankings', label: 'Rankings', render: rankings },
  { key: 'explorer', label: 'Explorer', render: explorer },
  { key: 'insights', label: 'Insights', render: insights },
];

const state = {
  typeKey: localStorage.getItem('vr-type') || 'all',
  real: localStorage.getItem('vr-real') === '1',
  view: 'overview',
};

function appState(): AppState {
  return {
    meta: metaSync(), places: placesSync(),
    typeKey: state.typeKey, real: state.real,
    openPlace, setHash: (h) => { location.hash = h; },
  };
}

const app = document.getElementById('app')!;

async function boot(): Promise<void> {
  app.innerHTML = `<div class="loading"><div class="spinner"></div><p>Loading Victorian rent data…</p></div>`;
  try {
    const meta = await loadMeta();
    await loadPlaces();
    document.title = `Victorian Rents — median weekly rents by suburb & council, ${meta.dataStart.split(' ')[1]}–${meta.headline.latestLabel.split(' ')[1]}`;
    render();
    initTooltip();
    initGlossary();
    window.addEventListener('hashchange', onHash);
    onHash();
  } catch (e) {
    app.innerHTML = `<div class="error-state"><h2>Couldn't load the data</h2><p>${esc((e as Error).message)}</p><button onclick="location.reload()">Retry</button></div>`;
  }
}

function render(): void {
  const meta = metaSync();
  app.innerHTML = `
    <header class="site-header">
      <div class="hd-inner">
        <a class="brand" href="#overview"><span class="brand-mark">▛</span><span class="brand-text">Victorian Rents</span></a>
        <nav class="tabs" id="tabs" aria-label="Views">${VIEWS.map((v) => `<button class="tab" data-view="${v.key}">${v.label}</button>`).join('')}</nav>
        <div class="hd-controls">
          <label class="type-select"><span class="sr-only">Property type</span>
            <select id="type-select">${meta.propTypes.map((t) => `<option value="${t.key}"${t.key === state.typeKey ? ' selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          </label>
          <label class="switch real-switch" title="Adjust for inflation (today's dollars)"><input type="checkbox" id="real-toggle" ${state.real ? 'checked' : ''}/><span>real&nbsp;$</span></label>
          <button class="icon-btn" id="about-btn" aria-label="About this site" title="About">?</button>
        </div>
      </div>
    </header>
    <main class="main-content" id="view"></main>
    <footer class="site-footer"><div class="footer-inner">
      <span>Data: <a href="https://discover.data.vic.gov.au/dataset/rental-report-quarterly-moving-annual-rents-by-suburb" target="_blank" rel="noopener">DFFH Rental Report</a> &amp; <a href="https://www.abs.gov.au" target="_blank" rel="noopener">ABS</a> (CC BY 4.0) · ${esc(meta.generatedFor)}</span>
      <span>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></span>
    </div></footer>`;

  document.getElementById('tabs')!.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', () => { location.hash = b.dataset.view!; }));
  const sel = document.getElementById('type-select') as HTMLSelectElement;
  sel.addEventListener('change', () => { state.typeKey = sel.value; localStorage.setItem('vr-type', state.typeKey); renderView(); });
  const rt = document.getElementById('real-toggle') as HTMLInputElement;
  rt.addEventListener('change', () => { state.real = rt.checked; localStorage.setItem('vr-real', state.real ? '1' : '0'); renderView(); });
  document.getElementById('about-btn')!.addEventListener('click', openAbout);
}

function onHash(): void {
  const h = location.hash.slice(1);
  const m = /^(suburb|lga)=(.+)$/.exec(h);
  if (m) { openPlace(m[1] as 'suburb' | 'lga', decodeURIComponent(m[2])); return; }
  const view = VIEWS.find((v) => v.key === h) ? h : 'overview';
  if (view !== state.view) { state.view = view; }
  renderView();
}

let activeView = '';
function renderView(): void {
  const viewEl = document.getElementById('view');
  if (!viewEl) return;
  document.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
  if (activeView === 'map' && state.view !== 'map') destroyMap();
  activeView = state.view;
  const v = VIEWS.find((x) => x.key === state.view)!;
  viewEl.scrollTop = 0;
  const r = v.render(viewEl, appState());
  if (r instanceof Promise) r.catch((e) => { viewEl.innerHTML = `<div class="error-state"><p>${esc((e as Error).message)}</p></div>`; });
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
}

/* ════════════════════════ per-place drawer ════════════════════════ */
let drawerEl: HTMLElement | null = null;
function closeDrawer(): void {
  if (!drawerEl) return;
  drawerEl.classList.remove('open');
  const el = drawerEl; drawerEl = null;
  setTimeout(() => el.remove(), 260); // detach from DOM (iOS scroll-safe)
  if (/^#(suburb|lga)=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#' + state.view);
}
function openPlace(kind: 'suburb' | 'lga', slug: string): void {
  const places = placesSync();
  const list = kind === 'lga' ? places.lgas : places.suburbs;
  const p = list.find((x) => x.slug === slug);
  if (!p) return;
  if (drawerEl) drawerEl.remove();
  history.replaceState(null, '', `${location.pathname}#${kind}=${encodeURIComponent(slug)}`);
  drawerEl = document.createElement('div');
  drawerEl.className = 'drawer-overlay';
  drawerEl.innerHTML = `<div class="drawer" role="dialog" aria-modal="true" aria-label="${esc(p.name)}">${drawerBody(p, kind)}</div>`;
  document.body.appendChild(drawerEl);
  drawerEl.addEventListener('click', (e) => { if (e.target === drawerEl) closeDrawer(); });
  drawerEl.querySelector('.drawer-close')!.addEventListener('click', closeDrawer);
  requestAnimationFrame(() => drawerEl!.classList.add('open'));
}
function drawerBody(p: Place, kind: 'suburb' | 'lga'): string {
  const meta = metaSync();
  const st = appState();
  const series = meta.propTypes.filter((t) => t.key !== 'all' && p.types[t.key]).map((t) => ({ label: t.short, color: TYPE_COLOR[t.key], values: displayMedian(p.types[t.key], st.real, meta.cpi) }));
  const allS = p.types.all;
  const now = current(allS);
  const vicNow = current(meta.victoria.all);
  const rankList = (kind === 'lga' ? placesSync().lgas : placesSync().suburbs).map((x) => current(x.types.all)).filter((v) => v != null) as number[];
  rankList.sort((a, b) => b - a);
  const rank = now != null ? rankList.indexOf(now) + 1 : null;
  const chartS = series.length ? series : (allS ? [{ label: 'All properties', color: TYPE_COLOR.all, values: displayMedian(allS, st.real, meta.cpi) }] : []);
  const line = chartS.length ? lineChart({ quarters: meta.quarters, series: chartS, height: 300, yFormat: (v) => '$' + Math.round(v), tipFormat: (v) => fmtMoneyWk(v) }) : '<p class="empty">No series.</p>';
  const stat = (k: string, v: string, cls = '') => `<div class="ds-stat"><span class="ds-k">${k}</span><span class="ds-v ${cls}">${v}</span></div>`;
  const chg = (ago: number) => { const v = changeOver(allS, ago); return `<span style="color:${v == null ? 'inherit' : v > 3 ? '#c2410c' : v < -3 ? '#15803d' : 'inherit'}">${fmtPct(v)}</span>`; };
  return `
    <button class="drawer-close" aria-label="Close">✕</button>
    <div class="drawer-head">
      <div class="ds-kind">${kind === 'lga' ? 'Local Government Area' : 'Suburb / town'} · ${esc(p.region)}</div>
      <h2>${esc(p.name)}</h2>
    </div>
    <div class="drawer-figure">${fmtMoneyWk(now)}<span>all properties · ${esc(meta.generatedFor)}${st.real ? ' · real $' : ''}</span></div>
    <div class="ds-stats">
      ${stat('1yr', fmtPct(changeOver(allS, 4)))}
      ${stat('5yr', fmtPct(changeOver(allS, 20)))}
      ${stat('Since ' + meta.dataStart, chg(0))}
      ${stat('vs Victoria', now != null && vicNow != null ? fmtPct((now / vicNow - 1) * 100) : '—')}
      ${stat('Rank' + (kind === 'lga' ? ' of councils' : ' of suburbs'), rank != null ? `#${rank} of ${rankList.length}` : '—')}
      ${stat('Lettings/qtr', fmtNum(currentCount(allS)))}
    </div>
    <div class="ds-chart-title">Rent history by property type${st.real ? ' (real $)' : ''}</div>
    <div class="chart-wrap">${line}</div>
    <div class="ds-table">${typeTable(p)}</div>`;
}
function typeTable(p: Place): string {
  const meta = metaSync();
  return `<table class="data-table compact"><thead><tr><th>Dwelling</th><th class="num">Now</th><th class="num">5yr</th><th class="num">Lettings</th></tr></thead><tbody>${
    meta.propTypes.map((t) => { const s = p.types[t.key]; if (!s) return ''; return `<tr><td><i class="sw" style="background:${TYPE_COLOR[t.key]}"></i>${esc(t.short)}</td><td class="num mono">${fmtMoneyWk(current(s))}</td><td class="num mono">${fmtPct(changeOver(s, 20))}</td><td class="num mono">${fmtNum(currentCount(s))}</td></tr>`; }).join('')
  }</tbody></table>`;
}

/* ════════════════════════ About modal ════════════════════════ */
function openAbout(): void {
  const meta = metaSync();
  const ov = document.createElement('div');
  ov.className = 'modal-overlay';
  ov.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="About Victorian Rents">
    <button class="modal-close" aria-label="Close">✕</button>
    <h2>About Victorian Rents</h2>
    <p>Renting is the cost-of-living story of the decade, but the raw numbers sit in dense government spreadsheets. This tool turns the Victorian Government's <strong>Rental Report</strong> into something you can actually explore: what it costs to rent in every Victorian suburb, town and council, by dwelling type, quarter by quarter, all the way back to ${esc(meta.dataStart)}.</p>
    <h3>Where the data comes from</h3>
    <p>The <a href="https://www.dffh.vic.gov.au/publications/rental-report" target="_blank" rel="noopener">Rental Report</a> is published every quarter by the Department of Families, Fairness and Housing (DFFH). It is built from <strong>rental bonds</strong> lodged with the Residential Tenancies Bond Authority — so it measures the rent paid by people <em>moving in</em> (new lettings), not sitting tenants. We use the two time-series workbooks (moving-annual medians by suburb, and quarterly medians by council), the ABS <strong>Consumer Price Index</strong> (Melbourne) to show rents in today's dollars, and ABS <strong>ASGS 2024</strong> council boundaries for the map.</p>
    <h3>How to read it</h3>
    <ul>
      <li><strong>Median, not average</strong> — the middle rent of new lettings, so a few mansions don't skew it.</li>
      <li><strong>Property type</strong> — switch between flats and houses in the header; it changes every view.</li>
      <li><strong>real&nbsp;$</strong> — toggle to strip out inflation and see the true rise in what renters pay.</li>
      <li><strong>The map is at council level</strong> because the report's suburb groupings (like “Albert Park-Middle Park-West St Kilda”) have no official boundaries. Suburb detail lives in the finder, rankings and explorer.</li>
    </ul>
    <h3>Caveats</h3>
    <ul>
      <li>Only <strong>new</strong> lettings are counted — this is the “asking” market, and can move faster than what continuing tenants pay.</li>
      <li>A “—” means too few lettings to report that cell (it is <em>not</em> zero). Small places with very low lettings are excluded from leaderboards.</li>
      <li>Victoria only. Other states publish rents differently.</li>
    </ul>
    <h3>Glossary</h3>
    <dl class="gloss-list">${Object.entries(GLOSSARY).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <h3>Sources</h3>
    <ul class="src-list">${meta.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join('')}</ul>
    <p class="modal-foot">Data © State of Victoria (DFFH) and © Commonwealth of Australia (ABS), both licensed CC BY 4.0. This is an independent tool, not affiliated with the Victorian Government.</p>
  </div>`;
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
  ov.querySelector('.modal-close')!.addEventListener('click', close);
  document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc2); } });
  requestAnimationFrame(() => ov.classList.add('open'));
}

/* ════════════════════════ glossary popover ════════════════════════ */
function initGlossary(): void {
  let pop: HTMLElement | null = null;
  const close = () => { pop?.remove(); pop = null; };
  document.addEventListener('click', (e) => {
    const t = (e.target as Element).closest('.gloss') as HTMLElement | null;
    if (!t) { if (pop && !pop.contains(e.target as Node)) close(); return; }
    const term = t.dataset.term!;
    const def = GLOSSARY[term];
    if (!def) return;
    close();
    pop = document.createElement('div');
    pop.className = 'gloss-pop';
    pop.innerHTML = `<strong>${esc(term)}</strong><p>${esc(def)}</p>`;
    document.body.appendChild(pop);
    const r = t.getBoundingClientRect();
    const pw = Math.min(300, window.innerWidth - 24);
    pop.style.width = pw + 'px';
    let left = r.left; if (left + pw > window.innerWidth - 12) left = window.innerWidth - pw - 12;
    pop.style.left = Math.max(12, left) + 'px';
    pop.style.top = (r.bottom + window.scrollY + 6) + 'px';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  document.addEventListener('keydown', (e) => {
    const t = (e.target as Element).closest?.('.gloss') as HTMLElement | null;
    if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); (t as HTMLElement).click(); }
  });
}

boot();
