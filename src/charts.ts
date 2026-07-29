// SPDX-License-Identifier: AGPL-3.0-or-later
// Hand-rolled SVG chart primitives. Every data mark carries a [data-tip] hover
// tooltip (attribute-escaped, newlines as &#10;) and an aria-label. No chart libs.
import type { Quarter } from './data';

/* ── escaping (innerHTML text vs attribute) ── */
export function esc(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
/** Attribute-safe value for data-tip / aria-label injected via innerHTML: escape,
 *  and encode newlines as the numeric entity so the browser renders real breaks. */
export function tip(s: string): string {
  return esc(s).replace(/\n/g, '&#10;');
}

export interface LineSeries { label: string; color: string; values: (number | null)[]; dashed?: boolean; width?: number }
export interface LineOpts {
  quarters: Quarter[];
  series: LineSeries[];
  height?: number;
  yFormat?: (v: number) => string;
  tipFormat?: (v: number | null) => string;
  bands?: { from: number; to: number; label: string; color?: string }[];
  markers?: { idx: number; label: string }[];
  yMin?: number;
}

function niceTicks(max: number, min = 0, n = 5): number[] {
  const span = max - min || 1;
  const step0 = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(t);
  return ticks;
}

/** Multi-series line chart. Full-height hover columns show every series at a quarter. */
export function lineChart(o: LineOpts): string {
  const W = 960, H = o.height ?? 380;
  const m = { top: 16, right: 16, bottom: 30, left: 54 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const q = o.quarters, n = q.length;
  const yf = o.yFormat ?? ((v) => String(Math.round(v)));
  const tf = o.tipFormat ?? ((v) => (v == null ? '—' : yf(v)));

  let vmax = 0, vmin = o.yMin ?? 0;
  for (const s of o.series) for (const v of s.values) if (v != null) { if (v > vmax) vmax = v; if (v < vmin) vmin = v; }
  if (vmax <= vmin) vmax = vmin + 1;
  const ticks = niceTicks(vmax, vmin);
  vmax = Math.max(vmax, ticks[ticks.length - 1]);

  const x = (i: number) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v: number) => m.top + ih - ((v - vmin) / (vmax - vmin)) * ih;

  let g = '';
  // bands
  for (const b of o.bands ?? []) {
    const x0 = x(Math.max(0, b.from)), x1 = x(Math.min(n - 1, b.to));
    g += `<rect x="${x0.toFixed(1)}" y="${m.top}" width="${(x1 - x0).toFixed(1)}" height="${ih}" fill="${b.color ?? 'rgba(148,163,184,0.16)'}"/>`;
    g += `<text x="${((x0 + x1) / 2).toFixed(1)}" y="${m.top + 12}" text-anchor="middle" class="ch-band-label">${esc(b.label)}</text>`;
  }
  // gridlines + y labels
  for (const t of ticks) {
    const yy = y(t);
    g += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + iw}" y2="${yy.toFixed(1)}" class="ch-grid"/>`;
    g += `<text x="${m.left - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="ch-axis">${esc(yf(t))}</text>`;
  }
  // x year labels
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (q[i].q === 2 && q[i].y % 4 === 0 && !seen.has(q[i].y)) {
      seen.add(q[i].y);
      g += `<text x="${x(i).toFixed(1)}" y="${(m.top + ih + 20).toFixed(1)}" text-anchor="middle" class="ch-axis">${q[i].y}</text>`;
    }
  }
  // series paths
  for (const s of o.series) {
    let d = '', pen = false;
    for (let i = 0; i < n; i++) {
      const v = s.values[i];
      if (v == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
      pen = true;
    }
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width ?? 2.4}" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linjoin="round" stroke-linecap="round"/>`;
  }
  // markers
  for (const mk of o.markers ?? []) {
    const xx = x(mk.idx);
    g += `<line x1="${xx.toFixed(1)}" y1="${m.top}" x2="${xx.toFixed(1)}" y2="${m.top + ih}" class="ch-marker"/>`;
    g += `<text x="${xx.toFixed(1)}" y="${(m.top + ih - 6).toFixed(1)}" text-anchor="middle" class="ch-marker-label">${esc(mk.label)}</text>`;
  }
  // hover columns
  const cw = iw / Math.max(1, n - 1);
  for (let i = 0; i < n; i++) {
    const lines = [q[i].label, ...o.series.map((s) => `${s.label}: ${tf(s.values[i])}`)];
    g += `<rect x="${(x(i) - cw / 2).toFixed(1)}" y="${m.top}" width="${cw.toFixed(1)}" height="${ih}" fill="transparent" class="ch-hit" data-tip="${tip(lines.join('\n'))}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>`;
}

/* ── horizontal bars (supports diverging around zero) ── */
export interface BarItem { label: string; value: number; color?: string; sub?: string; tip?: string; slug?: string }
export function barsH(items: BarItem[], o: { diverging?: boolean; valueFormat?: (v: number) => string; height?: number } = {}): string {
  const vf = o.valueFormat ?? ((v) => String(Math.round(v)));
  const rowH = 26, gap = 6, padL = 150, padR = 60, W = 960;
  const H = o.height ?? items.length * (rowH + gap) + 10;
  const maxAbs = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  const zoneW = W - padL - padR;
  const zero = o.diverging ? padL + zoneW / 2 : padL;
  const scale = o.diverging ? (zoneW / 2) / maxAbs : zoneW / maxAbs;
  let g = '';
  items.forEach((it, r) => {
    const yy = 8 + r * (rowH + gap);
    const w = Math.abs(it.value) * scale;
    const x0 = it.value < 0 ? zero - w : zero;
    const col = it.color ?? '#0f766e';
    const t = it.tip ?? `${it.label}: ${vf(it.value)}`;
    g += `<g class="bar-row${it.slug ? ' clickable' : ''}"${it.slug ? ` data-slug="${esc(it.slug)}"` : ''} data-tip="${tip(t)}">`;
    g += `<rect x="0" y="${yy}" width="${W}" height="${rowH}" fill="transparent"/>`;
    g += `<text x="${padL - 10}" y="${yy + rowH / 2 + 4}" text-anchor="end" class="bar-label">${esc(it.label)}</text>`;
    g += `<rect x="${x0.toFixed(1)}" y="${yy}" width="${Math.max(1, w).toFixed(1)}" height="${rowH}" rx="3" fill="${col}"/>`;
    g += `<text x="${(it.value < 0 ? x0 - 6 : x0 + w + 6).toFixed(1)}" y="${yy + rowH / 2 + 4}" text-anchor="${it.value < 0 ? 'end' : 'start'}" class="bar-value">${esc(vf(it.value))}</text>`;
    g += `</g>`;
  });
  if (o.diverging) g += `<line x1="${zero}" y1="4" x2="${zero}" y2="${H - 4}" class="ch-zero"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" class="chart bars" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>`;
}

/* ── sparkline ── */
export function sparkline(values: (number | null)[], color = '#0f766e', w = 120, h = 30): string {
  const pts = values.filter((v) => v != null) as number[];
  if (pts.length < 2) return `<svg viewBox="0 0 ${w} ${h}" class="spark"></svg>`;
  const min = Math.min(...pts), max = Math.max(...pts);
  const n = values.length;
  const x = (i: number) => (i / (n - 1)) * (w - 2) + 1;
  const y = (v: number) => h - 2 - ((v - min) / (max - min || 1)) * (h - 4);
  let d = '', pen = false;
  values.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `; pen = true; });
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`;
}

/* ── histogram (returns bins for click-filtering) ── */
export interface Bin { x0: number; x1: number; count: number }
export function makeBins(values: number[], nBins = 20): Bin[] {
  if (!values.length) return [];
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const step = span / nBins;
  const bins: Bin[] = Array.from({ length: nBins }, (_, i) => ({ x0: min + i * step, x1: min + (i + 1) * step, count: 0 }));
  for (const v of values) {
    let i = Math.floor((v - min) / step);
    if (i >= nBins) i = nBins - 1;
    if (i < 0) i = 0;
    bins[i].count++;
  }
  return bins;
}
export function histogram(bins: Bin[], o: { labelFormat: (v: number) => string; color?: string; activeIdx?: number | null }): string {
  const W = 960, H = 200, m = { top: 10, right: 12, bottom: 34, left: 40 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const maxC = Math.max(1, ...bins.map((b) => b.count));
  const bw = iw / bins.length;
  let g = '';
  const ticks = niceTicks(maxC);
  for (const t of ticks) { const yy = m.top + ih - (t / maxC) * ih; g += `<line x1="${m.left}" y1="${yy.toFixed(1)}" x2="${m.left + iw}" y2="${yy.toFixed(1)}" class="ch-grid"/><text x="${m.left - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" class="ch-axis">${t}</text>`; }
  bins.forEach((b, i) => {
    const h = (b.count / maxC) * ih;
    const x0 = m.left + i * bw;
    const active = o.activeIdx === i;
    g += `<g class="hist-bar clickable" data-bin="${i}" data-tip="${tip(`${o.labelFormat(b.x0)}–${o.labelFormat(b.x1)}\n${b.count} place${b.count === 1 ? '' : 's'}`)}">`;
    g += `<rect x="${(x0 + 1).toFixed(1)}" y="${m.top}" width="${(bw - 2).toFixed(1)}" height="${ih}" fill="transparent"/>`;
    g += `<rect x="${(x0 + 1).toFixed(1)}" y="${(m.top + ih - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" fill="${active ? '#ea580c' : o.color ?? '#0f766e'}"/>`;
    g += `</g>`;
  });
  // x labels at a few positions
  const step = Math.ceil(bins.length / 6);
  bins.forEach((b, i) => { if (i % step === 0) g += `<text x="${(m.left + i * bw).toFixed(1)}" y="${(m.top + ih + 18).toFixed(1)}" text-anchor="middle" class="ch-axis">${esc(o.labelFormat(b.x0))}</text>`; });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart hist" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>`;
}

/* ── heatmap (rows × cols) ── */
export interface HeatCell { value: number | null; color: string; tip: string }
export function heatmap(rowLabels: string[], colLabels: string[], cell: (r: number, c: number) => HeatCell, o: { cellText?: (v: number | null) => string } = {}): string {
  const cw = 96, chh = 30, padL = 150, padT = 26, W = padL + colLabels.length * cw + 8;
  const H = padT + rowLabels.length * chh + 6;
  let g = '';
  colLabels.forEach((c, ci) => { g += `<text x="${(padL + ci * cw + cw / 2).toFixed(1)}" y="${padT - 8}" text-anchor="middle" class="heat-col">${esc(c)}</text>`; });
  rowLabels.forEach((rl, ri) => {
    g += `<text x="${padL - 8}" y="${(padT + ri * chh + chh / 2 + 4).toFixed(1)}" text-anchor="end" class="heat-row">${esc(rl)}</text>`;
    colLabels.forEach((_, ci) => {
      const cd = cell(ri, ci);
      const x0 = padL + ci * cw, y0 = padT + ri * chh;
      g += `<g class="heat-cell" data-tip="${tip(cd.tip)}"><rect x="${x0}" y="${y0}" width="${cw - 2}" height="${chh - 2}" rx="2" fill="${cd.color}"/>`;
      if (o.cellText) g += `<text x="${x0 + cw / 2}" y="${y0 + chh / 2 + 4}" text-anchor="middle" class="heat-val">${esc(o.cellText(cd.value))}</text>`;
      g += `</g>`;
    });
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart heat" preserveAspectRatio="xMidYMid meet" role="img">${g}</svg>`;
}
