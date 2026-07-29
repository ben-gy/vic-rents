// Build the Victorian Rents dataset from the DFFH "Rental Report" workbooks.
//
// Downloads the two cumulative time-series workbooks (Moving Annual Rents by
// Suburb; Quarterly Median Rents by LGA) — resolved to their newest quarter via
// the data.vic CKAN API — plus the ABS Melbourne CPI (to deflate rents to real
// terms) and the ABS ASGS 2024 LGA boundaries for Victoria. Parses everything
// with the dependency-free reader in parse.mjs, enforces the reconciliation
// gates, and writes public/data/{meta,places}.json + boundaries.geojson.
//
// SOURCE CADENCE: quarterly — DFFH publishes the Rental Report every quarter,
// roughly five months in arrears. The data-pipeline workflow crons quarterly.
// Re-runs are idempotent: the embedded stamp is the DATA quarter, not run time.
//
// SPDX-License-Identifier: AGPL-3.0-or-later
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseWorkbook, extractSheet, propTypeKey, PROP_TYPES, parseQuarter,
  reconcileMetroVictoria, reconcileLgaSum, totalRow, slug, lgaKey, pct,
} from './parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'public', 'data');
const CACHE = join(HERE, '.cache');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const log = (...a) => console.log('[collect]', ...a);

async function fetchBuf(url, { accept } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': UA, Accept: accept ?? '*/*', 'Accept-Language': 'en-AU,en;q=0.9' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      log(`  attempt ${attempt} failed for ${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, attempt * 1500));
    }
  }
  throw lastErr;
}
const fetchText = async (url, opts) => (await fetchBuf(url, opts)).toString('utf8');

/* ── resolve the newest workbook for a data.vic dataset ─────────────────── */
// The CKAN resource names are inconsistent, so we score every resource URL by the
// quarter parsed from its name and try the newest first, falling back down the
// list until a resource parses into a workbook with the expected sheets.
const QUARTER_RANK = (s) => {
  const m = /\b(march|june|september|december|mar|jun|sep|dec)\D*(\d{4})/i.exec(s || '');
  if (!m) return 0;
  const mo = { march: 1, mar: 1, june: 2, jun: 2, september: 3, sep: 3, december: 4, dec: 4 }[m[1].toLowerCase()];
  return Number(m[2]) * 4 + mo;
};

async function resolveWorkbook(datasetSlug, fallbackUrl, cacheName) {
  const cached = join(CACHE, cacheName);
  if (process.env.USE_CACHE && existsSync(cached)) {
    log(`cache   ${cacheName}`);
    return readFileSync(cached);
  }
  let candidates = [fallbackUrl];
  try {
    const pkg = JSON.parse(await fetchText(`https://discover.data.vic.gov.au/api/3/action/package_show?id=${datasetSlug}`));
    const res = (pkg.result?.resources || [])
      .filter((r) => /xlsx?$/i.test(r.format || '') || /xlsx?/i.test(r.url || ''))
      .map((r) => ({ url: r.url, rank: Math.max(QUARTER_RANK(r.name), QUARTER_RANK(r.url)) }))
      .sort((a, b) => b.rank - a.rank);
    candidates = [...res.map((r) => r.url), fallbackUrl];
  } catch (e) {
    log(`  CKAN lookup failed (${e.message}); using fallback URL`);
  }
  for (const url of candidates) {
    try {
      const buf = await fetchBuf(url, { accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,*/*' });
      if (buf.length < 50000) throw new Error(`too small (${buf.length}b)`);
      const wb = parseWorkbook(buf);
      if (!Object.keys(wb).some((s) => propTypeKey(s) === 'all')) throw new Error('no "All properties" sheet');
      log(`fetched ${cacheName} from ${url} (${(buf.length / 1024) | 0} KB)`);
      writeFileSync(cached, buf);
      return buf;
    } catch (e) {
      log(`  candidate rejected (${url}): ${e.message}`);
    }
  }
  throw new Error(`could not resolve a usable workbook for ${datasetSlug}`);
}

/* ── extract every property-type sheet of a workbook ────────────────────── */
function extractAll(wb) {
  const byType = {};
  for (const name of Object.keys(wb)) {
    const k = propTypeKey(name);
    if (k) byType[k] = extractSheet(wb[name]);
  }
  return byType;
}

/* ── ABS Melbourne CPI (All groups, index numbers, quarterly) ───────────── */
async function fetchCpi() {
  try {
    const csv = await fetchText(
      'https://data.api.abs.gov.au/rest/data/CPI/1.10001.10.2.Q?startPeriod=1999-Q1&format=csv',
      { accept: 'application/vnd.sdmx.data+csv' },
    );
    const lines = csv.trim().split(/\r?\n/);
    const head = lines[0].split(',');
    const tp = head.indexOf('TIME_PERIOD');
    const ov = head.indexOf('OBS_VALUE');
    const map = {};
    for (const line of lines.slice(1)) {
      const c = line.split(',');
      const m = /(\d{4})-Q([1-4])/.exec(c[tp] || '');
      const val = Number(c[ov]);
      if (m && Number.isFinite(val)) map[`${m[1]}Q${m[2]}`] = val;
    }
    log(`CPI     ${Object.keys(map).length} quarters`);
    return map;
  } catch (e) {
    log(`  CPI fetch failed (${e.message}); real-rent view will be omitted`);
    return {};
  }
}

/* ── ABS ASGS 2024 LGA boundaries for Victoria ──────────────────────────── */
async function fetchBoundaries() {
  const raw = join(CACHE, 'vic-lga-raw.geojson');
  if (!(process.env.USE_CACHE && existsSync(raw))) {
    const base = 'https://geo.abs.gov.au/arcgis/rest/services/ASGS2024/LGA/MapServer/1/query';
    const q = `${base}?where=${encodeURIComponent("state_name_2021='Victoria'")}&outFields=LGA_NAME_2024,LGA_CODE_2024&outSR=4326&resultRecordCount=200&f=geojson`;
    const gj = JSON.parse(await fetchText(q));
    if (!gj.features || gj.features.length < 70) throw new Error(`only ${gj.features?.length} VIC LGA polygons`);
    writeFileSync(raw, JSON.stringify(gj));
    log(`fetched ${gj.features.length} VIC LGA polygons`);
  }
  const simplified = join(CACHE, 'vic-lga.geojson');
  execFileSync('npx', ['--yes', 'mapshaper', raw, '-simplify', '6%', 'keep-shapes', '-o', 'precision=0.0001', 'format=geojson', simplified], {
    stdio: 'inherit', cwd: HERE,
  });
  return JSON.parse(readFileSync(simplified, 'utf8'));
}

/* ─────────────────────────────── main ─────────────────────────────────── */
async function main() {
  const suburbWb = parseWorkbook(await resolveWorkbook(
    'rental-report-quarterly-moving-annual-rents-by-suburb',
    'https://www.dffh.vic.gov.au/moving-annual-rent-suburb-september-quarter-2025-excel',
    'suburb.xlsx',
  ));
  const lgaWb = parseWorkbook(await resolveWorkbook(
    'rental-report-quarterly-quarterly-median-rents-by-lga',
    'https://www.dffh.vic.gov.au/quarterly-median-rents-local-government-area-september-quarter-2025-excel',
    'lga.xlsx',
  ));

  const suburbSheets = extractAll(suburbWb);
  const lgaSheets = extractAll(lgaWb);

  // ── reconciliation gates (hard: fail the build) ──
  let g1checks = 0;
  for (const [key, sh] of Object.entries(lgaSheets)) {
    const g1 = reconcileMetroVictoria(sh);
    if (!g1.ok) throw new Error(`GATE1 FAILED (${key}): Metro+Non-Metro≠Victoria — ${JSON.stringify(g1.mismatches.slice(0, 3))}`);
    g1checks += g1.checked;
  }
  const g2 = reconcileLgaSum(lgaSheets.all);
  if (!g2.ok) throw new Error(`GATE2 FAILED: Σ(LGA)≠Victoria — ${JSON.stringify(g2.mismatches.slice(0, 3))}`);
  log(`GATES OK — gate1 ${g1checks} quarter×type checks across 7 sheets; gate2 ${g2.checked} quarters (Σ LGA == Victoria)`);

  // ── union timeline ──
  const qMap = new Map();
  for (const sh of [...Object.values(lgaSheets), ...Object.values(suburbSheets)]) {
    for (const q of sh.quarters) qMap.set(q.key, q);
  }
  const quarters = [...qMap.values()].sort((a, b) => a.order - b.order);
  const qIndex = new Map(quarters.map((q, i) => [q.key, i]));
  const N = quarters.length;

  // remap a sheet's array onto the union timeline
  const remap = (sheet, arr) => {
    const out = new Array(N).fill(null);
    sheet.quarters.forEach((q, i) => { out[qIndex.get(q.key)] = arr[i]; });
    return out;
  };

  // build per-place series across all property types
  function buildPlaces(sheets, { isLga } = {}) {
    // union of names across type sheets (some places only appear in some types)
    const order = [];
    const idx = new Map();
    for (const key of PROP_TYPES.map((t) => t.key)) {
      const sh = sheets[key];
      if (!sh) continue;
      for (const rec of sh.records) {
        if (rec.isTotal) continue;
        if (!idx.has(rec.name)) { idx.set(rec.name, { name: rec.name, region: rec.region, types: {} }); order.push(rec.name); }
      }
    }
    for (const key of PROP_TYPES.map((t) => t.key)) {
      const sh = sheets[key];
      if (!sh) continue;
      for (const rec of sh.records) {
        if (rec.isTotal) continue;
        const p = idx.get(rec.name);
        if (!p.region && rec.region) p.region = rec.region;
        p.types[key] = { median: remap(sh, rec.median), count: remap(sh, rec.count) };
      }
    }
    return order.map((name) => {
      const p = idx.get(name);
      return { name, slug: slug(name), region: p.region || 'Other', ...(isLga ? { key: lgaKey(name) } : {}), types: p.types };
    });
  }

  const suburbs = buildPlaces(suburbSheets, { isLga: false });
  const lgas = buildPlaces(lgaSheets, { isLga: true });

  // Victoria state totals (from the LGA "Victoria" total row) per property type
  const victoria = {};
  for (const key of PROP_TYPES.map((t) => t.key)) {
    const sh = lgaSheets[key];
    const vic = sh && totalRow(sh, 'Victoria');
    if (vic) victoria[key] = { median: remap(sh, vic.median), count: remap(sh, vic.count) };
  }
  const metroRow = lgaSheets.all && totalRow(lgaSheets.all, 'Metro');
  const nonMetroRow = lgaSheets.all && totalRow(lgaSheets.all, 'Non-Metro');
  const metro = metroRow ? { median: remap(lgaSheets.all, metroRow.median), count: remap(lgaSheets.all, metroRow.count) } : null;
  const nonMetro = nonMetroRow ? { median: remap(lgaSheets.all, nonMetroRow.median), count: remap(lgaSheets.all, nonMetroRow.count) } : null;

  // ── CPI aligned to the union timeline ──
  const cpiMap = await fetchCpi();
  const cpi = quarters.map((q) => cpiMap[q.key] ?? null);

  // ── boundaries: attach the DFFH LGA match to each polygon ──
  let boundaries = { type: 'FeatureCollection', features: [] };
  try {
    const gj = await fetchBoundaries();
    const byKey = new Map(lgas.map((l) => [l.key, l]));
    let matched = 0;
    for (const f of gj.features) {
      const absName = f.properties.LGA_NAME_2024 || f.properties.lga_name_2024 || '';
      const k = lgaKey(absName);
      const m = byKey.get(k);
      if (m) matched++;
      f.properties = { abs: absName, key: k, name: m ? m.name : absName, slug: m ? m.slug : slug(absName), matched: !!m };
    }
    boundaries = gj;
    const unmatchedDffh = lgas.filter((l) => !gj.features.some((f) => f.properties.key === l.key)).map((l) => l.name);
    log(`boundaries: ${matched}/${gj.features.length} polygons matched a DFFH LGA; unmatched DFFH LGAs: ${unmatchedDffh.join(', ') || 'none'}`);
  } catch (e) {
    log(`  boundary build failed (${e.message}); shipping without map polygons`);
  }

  // ── headline stats (all-properties) ──
  const last = N - 1;
  const vAll = victoria.all.median;
  const firstIdx = vAll.findIndex((v) => v != null);
  const medianNow = vAll[last];
  const medianStart = vAll[firstIdx];
  const headlineChangeSince = quarters[firstIdx];

  // biggest riser/faller among LGAs (all properties, change over full window where both ends present)
  const changeAll = (series) => {
    const a = series[last];
    let b = null, bi = -1;
    for (let i = 0; i < N; i++) if (series[i] != null) { b = series[i]; bi = i; break; }
    return a != null && b != null ? { pct: pct(a, b), from: quarters[bi].label, aValue: a, bValue: b } : null;
  };
  const lgaChanges = lgas
    .map((l) => ({ name: l.name, slug: l.slug, now: l.types.all?.median[last] ?? null, ch: changeAll(l.types.all?.median || []) }))
    .filter((x) => x.ch && x.now != null);
  const withNow = lgas.map((l) => ({ name: l.name, slug: l.slug, now: l.types.all?.median[last] ?? null })).filter((x) => x.now != null);
  const dearest = [...withNow].sort((a, b) => b.now - a.now)[0];
  const cheapest = [...withNow].sort((a, b) => a.now - b.now)[0];
  const riser = [...lgaChanges].sort((a, b) => b.ch.pct - a.ch.pct)[0];

  const headline = {
    latestLabel: quarters[last].label,
    medianNow, medianStart, sinceLabel: headlineChangeSince.label,
    pctChange: Math.round(pct(medianNow, medianStart)),
    lettingsNow: victoria.all.count[last],
    metroNow: metro?.median[last] ?? null,
    regionalNow: nonMetro?.median[last] ?? null,
    dearestLga: dearest, cheapestLga: cheapest, biggestRiserLga: riser,
    cpiChangePct: cpi[firstIdx] != null && cpi[last] != null ? Math.round(pct(cpi[last], cpi[firstIdx])) : null,
  };

  const meta = {
    title: 'Victorian Rents',
    generatedFor: quarters[last].label,
    latestQuarter: quarters[last].key,
    dataStart: quarters[firstIdx].label,
    quarters: quarters.map((q) => ({ key: q.key, label: q.label, y: q.y, q: q.q })),
    propTypes: PROP_TYPES.map((t) => ({ key: t.key, label: t.label, short: t.short })),
    regions: {
      suburb: [...new Set(suburbs.map((s) => s.region))].sort(),
      lga: [...new Set(lgas.map((l) => l.region))].sort(),
    },
    counts: { suburbs: suburbs.length, lgas: lgas.length },
    cpi,
    victoria, metro, nonMetro,
    headline,
    sources: [
      { name: 'DFFH Rental Report — Moving annual median rents by suburb', url: 'https://discover.data.vic.gov.au/dataset/rental-report-quarterly-moving-annual-rents-by-suburb' },
      { name: 'DFFH Rental Report — Quarterly median rents by LGA', url: 'https://discover.data.vic.gov.au/dataset/rental-report-quarterly-quarterly-median-rents-by-lga' },
      { name: 'ABS Consumer Price Index (Melbourne, all groups)', url: 'https://www.abs.gov.au/statistics/economy/price-indexes-and-inflation/consumer-price-index-australia' },
      { name: 'ABS ASGS 2024 LGA boundaries', url: 'https://www.abs.gov.au/statistics/standards/australian-statistical-geography-standard-asgs-edition-3' },
    ],
    license: 'DFFH & ABS data: CC BY 4.0',
  };

  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta));
  writeFileSync(join(OUT, 'places.json'), JSON.stringify({ suburbs, lgas }));
  writeFileSync(join(OUT, 'boundaries.geojson'), JSON.stringify(boundaries));
  log(`wrote meta.json, places.json (${suburbs.length} suburbs, ${lgas.length} LGAs, ${N} quarters), boundaries.geojson (${boundaries.features.length} polygons)`);
  log(`headline: Victoria all-properties median $${medianStart}/wk (${headline.sinceLabel}) → $${medianNow}/wk (${headline.latestLabel}), +${headline.pctChange}%`);
}

main().catch((e) => { console.error(e); process.exit(1); });
