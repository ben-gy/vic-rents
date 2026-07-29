// Dependency-free XLSX reader + pure extractors, canonicalisers and reconciliation
// gates for the Victorian DFFH "Rental Report" workbooks (Moving Annual Rents by
// Suburb, and Quarterly Median Rents by LGA). Uses only Node built-ins (zlib);
// takes buffers/objects and returns objects, so the vitest suite imports it with
// zero I/O and zero dependencies.
//
// SPDX-License-Identifier: AGPL-3.0-or-later
import { inflateRawSync } from 'node:zlib';

/* ─────────────────────────── minimal zip + xlsx ─────────────────────────── */
// (identical reader used across the factory's xlsx pipelines)

function findEOCD(b) {
  for (let i = b.length - 22; i >= 0; i--) if (b.readUInt32LE(i) === 0x06054b50) return i;
  throw new Error('not a zip (no EOCD)');
}
function readCentralDir(b) {
  const eocd = findEOCD(b);
  const count = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const files = {};
  for (let i = 0; i < count; i++) {
    const nameLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const lho = b.readUInt32LE(off + 42);
    files[b.toString('utf8', off + 46, off + 46 + nameLen)] = lho;
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}
function extractEntry(b, lho) {
  const nameLen = b.readUInt16LE(lho + 26);
  const extraLen = b.readUInt16LE(lho + 28);
  const method = b.readUInt16LE(lho + 8);
  const compSize = b.readUInt32LE(lho + 18);
  const start = lho + 30 + nameLen + extraLen;
  const comp = b.subarray(start, start + compSize);
  return method === 0 ? comp : inflateRawSync(comp);
}

const XML_ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
function unescapeXml(s) {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => XML_ENT[m])
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}
function colToIndex(ref) {
  let n = 0;
  for (const c of ref.replace(/\d+/g, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Parse an .xlsx buffer into { [sheetName]: rows } (rows = array of cell-string arrays). */
export function parseWorkbook(buffer) {
  const files = readCentralDir(buffer);
  const read = (name) => (files[name] !== undefined ? extractEntry(buffer, files[name]).toString('utf8') : '');

  let sst = [];
  if (files['xl/sharedStrings.xml'] !== undefined) {
    const sx = read('xl/sharedStrings.xml');
    sst = [...sx.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => {
      const runs = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]);
      return unescapeXml(runs.join(''));
    });
  }

  const wb = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  const relMap = {};
  for (const m of rels.matchAll(/<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"[^>]*>/g)) relMap[m[1]] = m[2];
  for (const m of rels.matchAll(/<Relationship[^>]*Target="([^"]*)"[^>]*Id="([^"]*)"[^>]*>/g)) relMap[m[2]] = m[1];

  const sheetOrder = [];
  for (const m of wb.matchAll(/<sheet[^>]*\/?>/g)) {
    const tag = m[0];
    const name = /name="([^"]*)"/.exec(tag)?.[1];
    const rid = /r:id="([^"]*)"/.exec(tag)?.[1];
    if (!name || !rid || !relMap[rid]) continue;
    let target = relMap[rid];
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    sheetOrder.push([unescapeXml(name).trim(), target]);
  }

  const out = {};
  for (const [name, target] of sheetOrder) {
    if (files[target] === undefined) continue;
    const xml = read(target);
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const arr = [];
      for (const cm of rm[2].matchAll(
        /<c[^>]*r="([A-Z]+)\d+"([^>]*)>(?:<v>([\s\S]*?)<\/v>|<is>(?:<t[^>]*>([\s\S]*?)<\/t>)?<\/is>)?<\/c>/g,
      )) {
        const col = colToIndex(cm[1]);
        const isStr = /t="s"/.test(cm[2]);
        let val = cm[3] !== undefined ? cm[3] : cm[4] !== undefined ? unescapeXml(cm[4]) : '';
        if (isStr && val !== '') val = sst[+val] ?? '';
        arr[col] = val;
      }
      rows[+rm[1] - 1] = arr;
    }
    out[name] = rows.map((r) => (r ? Array.from(r, (x) => x ?? '') : []));
  }
  return out;
}

/* ─────────────────────────── cell helpers ─────────────────────────── */

// In the DFFH workbooks a value of "-" (and blanks) means the cell is
// suppressed / not published (a lettings count below the reporting threshold,
// which is NOT zero). Coerce those to null, never 0.
const NA = new Set(['', '-', '–', '—', 'n/a', 'na', 'n.a.', '..', '.', 'np', 'nil', 's']);
export function toNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (NA.has(s.toLowerCase())) return null;
  const n = Number(s.replace(/[,$]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/* ─────────────────────────── property types ─────────────────────────── */
// Canonical property-type keys, with the sheet-name aliases used by BOTH files
// (the suburb file spells them out, the LGA file abbreviates).
export const PROP_TYPES = [
  { key: '1bf', label: '1 bedroom flat', short: '1BR flat', aliases: ['1 bedroom flat', '1br flat'] },
  { key: '2bf', label: '2 bedroom flat', short: '2BR flat', aliases: ['2 bedroom flat', '2br flat'] },
  { key: '3bf', label: '3 bedroom flat', short: '3BR flat', aliases: ['3 bedroom flat', '3br flat'] },
  { key: '2bh', label: '2 bedroom house', short: '2BR house', aliases: ['2 bedroom house', '2br house'] },
  { key: '3bh', label: '3 bedroom house', short: '3BR house', aliases: ['3 bedroom house', '3br house'] },
  { key: '4bh', label: '4 bedroom house', short: '4BR house', aliases: ['4 bedroom house', '4br house'] },
  { key: 'all', label: 'All properties', short: 'All properties', aliases: ['all properties'] },
];
/** Resolve a workbook sheet name to a canonical property-type key (or null). */
export function propTypeKey(sheetName) {
  const s = String(sheetName ?? '').trim().toLowerCase();
  for (const t of PROP_TYPES) if (t.aliases.includes(s)) return t.key;
  return null;
}

/* ─────────────────────────── quarter parsing ─────────────────────────── */

const MONTH_Q = { mar: 1, jun: 2, sep: 3, dec: 4 };
/** "Sep 2025" → { key:'2025Q3', y:2025, q:3, label:'Sep 2025', order:8103 }. */
export function parseQuarter(label) {
  const m = /([A-Za-z]{3})[a-z]*\s+((?:19|20)\d{2})/.exec(String(label ?? '').trim());
  if (!m) return null;
  const q = MONTH_Q[m[1].slice(0, 3).toLowerCase()];
  if (!q) return null;
  const y = Number(m[2]);
  return { key: `${y}Q${q}`, y, q, label: `${m[1].slice(0, 1).toUpperCase()}${m[1].slice(1, 3).toLowerCase()} ${y}`, order: y * 4 + q };
}

/* ─────────────────────────── sheet extraction ─────────────────────────── */
// Layout of every property-type sheet (both files):
//   row 0: title
//   row 1 (header): col A = property-type label; from col 2 on, quarter labels
//          repeated in (Count, Median) pairs — 'Mar 2000','Mar 2000','Jun 2000'…
//   row 2: 'Count','Median','Count','Median',…
//   row 3+: col 0 = region (SPARSE — set only on the first row of each group),
//           col 1 = place name, then (count, median) per quarter.
// Region is carried down. Total rows are identified by name/region label, never
// by position.

const TOTAL_NAMES = new Set(['group total', 'victoria', 'metro', 'non-metro', 'total', 'table total']);
const TOTAL_REGIONS = new Set(['table total', 'metro non-metro', 'metro/non-metro']);

/** Extract one property-type sheet into a normalised shape. */
export function extractSheet(rows) {
  if (!rows || rows.length < 4) return { quarters: [], records: [] };
  const header = rows[1] || [];
  // Column map: for each column c≥2 whose header parses to a quarter and whose
  // sub-header (row 2) is 'Count', treat (c=count, c+1=median).
  const sub = rows[2] || [];
  const cols = [];
  for (let c = 2; c < header.length; c++) {
    const q = parseQuarter(header[c]);
    const isCount = String(sub[c] ?? '').trim().toLowerCase() === 'count';
    if (q && isCount) cols.push({ c, q });
  }
  const quarters = cols.map((x) => x.q);

  const records = [];
  let region = '';
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r] || [];
    const rawRegion = String(row[0] ?? '').trim();
    if (rawRegion) region = rawRegion;
    const name = String(row[1] ?? '').trim();
    if (!name) continue;
    const count = [];
    const median = [];
    for (const { c } of cols) {
      count.push(toNum(row[c]));
      median.push(toNum(row[c + 1]));
    }
    const isTotal = TOTAL_NAMES.has(name.toLowerCase()) || TOTAL_REGIONS.has(rawRegion.toLowerCase());
    records.push({ region, rawRegion, name, count, median, isTotal });
  }
  return { quarters, records };
}

/** Find the total row whose place-name matches (case-insensitive), last wins. */
export function totalRow(sheet, name) {
  const want = name.toLowerCase();
  let found = null;
  for (const rec of sheet.records) if (rec.name.toLowerCase() === want) found = rec;
  return found;
}

/* ─────────────────────────── reconciliation gates ─────────────────────────── */

/**
 * GATE 1 (exact): for every quarter, Metro count + Non-Metro count must equal the
 * published Victoria total count in the METRO NON-METRO block of an LGA sheet.
 * A shifted column breaks it. Returns { checked, mismatches[] }.
 */
export function reconcileMetroVictoria(sheet) {
  const metro = totalRow(sheet, 'Metro');
  const nonMetro = totalRow(sheet, 'Non-Metro');
  const vic = totalRow(sheet, 'Victoria');
  const mismatches = [];
  let checked = 0;
  if (!metro || !nonMetro || !vic) return { checked: 0, mismatches: [{ reason: 'missing total rows' }], ok: false };
  for (let i = 0; i < sheet.quarters.length; i++) {
    const m = metro.count[i];
    const n = nonMetro.count[i];
    const v = vic.count[i];
    if (m == null || n == null || v == null) continue;
    checked++;
    if (m + n !== v) mismatches.push({ quarter: sheet.quarters[i].key, metro: m, nonMetro: n, victoria: v, got: m + n });
  }
  return { checked, mismatches, ok: mismatches.length === 0 };
}

/**
 * GATE 2 (exact): for every quarter, the sum of the individual LGA lettings
 * counts must equal the published Victoria total count. Excludes total rows.
 */
export function reconcileLgaSum(sheet) {
  const vic = totalRow(sheet, 'Victoria');
  const lgas = sheet.records.filter((r) => !r.isTotal);
  const mismatches = [];
  let checked = 0;
  if (!vic) return { checked: 0, mismatches: [{ reason: 'missing Victoria total' }], ok: false };
  for (let i = 0; i < sheet.quarters.length; i++) {
    const v = vic.count[i];
    if (v == null) continue;
    let sum = 0;
    let anyMissing = false;
    for (const l of lgas) {
      if (l.count[i] == null) anyMissing = true;
      else sum += l.count[i];
    }
    // Only assert when no member is suppressed, else the sum is a lower bound.
    if (anyMissing) continue;
    checked++;
    if (sum !== v) mismatches.push({ quarter: sheet.quarters[i].key, sum, victoria: v });
  }
  return { checked, mismatches, ok: mismatches.length === 0 };
}

/* ─────────────────────────── name canonicalisation ─────────────────────────── */

/** URL/id-safe slug. */
export function slug(name) {
  return String(name)
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// The DFFH LGA labels differ from ABS ASGS LGA names by suffix and a couple of
// contractions. Normalise both sides to a comparison key for the boundary join.
const LGA_FIXUPS = [
  [/mornington\s+penin['’]?a/i, 'mornington peninsula'],
  [/colac[\s-]*otway/i, 'colac otway'],
  [/latrobe/i, 'latrobe'],
];
/** Comparison key for joining a DFFH LGA name to an ABS LGA_NAME_2024. */
export function lgaKey(name) {
  let s = String(name ?? '').trim().toLowerCase();
  s = s.replace(/\s*\([^)]*\)\s*$/i, ''); // drop ABS suffix: "(C)"/"(S)"/"(RC)"/"(B)"/"(Vic.)"
  for (const [re, to] of LGA_FIXUPS) s = s.replace(re, to);
  s = s.replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  return s;
}

/* ─────────────────────────── shared helpers ─────────────────────────── */

export const pct = (a, b) => (a == null || b == null || b === 0 ? null : ((a - b) / b) * 100);
export const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
