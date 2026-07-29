// SPDX-License-Identifier: AGPL-3.0-or-later
// Leaflet LGA choropleth for Victoria. Adapted from patterns/leafletMap.ts.
// Boundaries are real ABS ASGS 2024 polygons (public/data/boundaries.geojson).
// The map container establishes its own stacking context (see .map-frame CSS)
// so Leaflet panes never paint over the app's drawers/modals.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  BASE, current, currentCount, changeOver, changeColor, levelColor, fmtMoneyWk, fmtNum, fmtPct,
  type Place, type Meta, type Places,
} from './data';

export type MapMode = 'level' | 'chg1y' | 'chg5y' | 'chgAll' | 'lettings';
const MODES: { key: MapMode; label: string }[] = [
  { key: 'level', label: 'Rent now' },
  { key: 'chg1y', label: 'Change 1yr' },
  { key: 'chg5y', label: 'Change 5yr' },
  { key: 'chgAll', label: 'Change all-time' },
  { key: 'lettings', label: 'Lettings' },
];

interface MapState { meta: Meta; places: Places; typeKey: string }
let mapInstance: L.Map | null = null;
let geojson: any = null;
let mode: MapMode = 'level';

function valueFor(p: Place, typeKey: string, m: MapMode): number | null {
  const s = p.types[typeKey];
  if (!s) return null;
  if (m === 'level') return current(s);
  if (m === 'lettings') return currentCount(s);
  if (m === 'chg1y') return changeOver(s, 4);
  if (m === 'chg5y') return changeOver(s, 20);
  return changeOver(s, 0);
}

export async function renderMapView(container: HTMLElement, st: MapState, openLGA: (slug: string) => void): Promise<void> {
  container.innerHTML = `
    <div class="view-head">
      <h2>Rent map of Victoria</h2>
      <p class="view-sub">Every one of Victoria's 79 councils, shaded by median rent — or how fast it has changed. Click a council for its full history. Suburbs sit inside these councils; the map is drawn at council level because the report's suburb groupings have no official boundaries.</p>
    </div>
    <div class="map-controls" role="tablist" aria-label="Map measure">
      ${MODES.map((m) => `<button type="button" class="seg${m.key === mode ? ' active' : ''}" data-mode="${m.key}">${m.label}</button>`).join('')}
    </div>
    <div class="map-frame"><div class="map-canvas" id="rent-map"></div><div class="map-legend" id="map-legend"></div></div>`;

  const buttons = container.querySelectorAll<HTMLButtonElement>('button[data-mode]');
  buttons.forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.mode as MapMode;
    buttons.forEach((x) => x.classList.toggle('active', x === b));
    restyle(st, openLGA);
  }));

  const canvas = container.querySelector('#rent-map') as HTMLElement;
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  const map = L.map(canvas, { minZoom: 5, maxZoom: 11, zoomControl: true, scrollWheelZoom: false, attributionControl: true });
  mapInstance = map;
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: 'Tiles © CARTO · Boundaries: ABS ASGS 2024 (CC BY 4.0) · Rents: DFFH (CC BY 4.0)',
    subdomains: 'abcd', minZoom: 5, maxZoom: 11,
  }).addTo(map);

  if (!geojson) {
    geojson = await fetch(`${BASE}data/boundaries.geojson`).then((r) => { if (!r.ok) throw new Error('boundaries'); return r.json(); });
  }
  restyle(st, openLGA);

  const fit = () => {
    map.invalidateSize();
    const layer = (map as any)._rentLayer as L.GeoJSON | undefined;
    if (layer) { const b = layer.getBounds(); if (b.isValid() && canvas.clientHeight > 50) map.fitBounds(b, { padding: [10, 10] }); }
  };
  const ro = new ResizeObserver(() => { if (canvas.clientHeight > 50) { fit(); ro.disconnect(); } });
  ro.observe(canvas);
  setTimeout(fit, 350);
}

function restyle(st: MapState, openLGA: (slug: string) => void): void {
  const map = mapInstance;
  if (!map || !geojson) return;
  const bySlug = new Map(st.places.lgas.map((l) => [l.slug, l]));
  const isChange = mode.startsWith('chg');
  const vals: number[] = [];
  for (const f of geojson.features) {
    const p = bySlug.get(f.properties.slug);
    const v = p ? valueFor(p, st.typeKey, mode) : null;
    if (v != null) vals.push(v);
  }
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;

  const colorFor = (v: number | null): string => {
    if (v == null) return '#e5e7eb';
    if (isChange) return changeColor(v);
    return levelColor(v, min, max);
  };
  const fmt = (v: number | null): string => {
    if (v == null) return 'no data';
    if (mode === 'lettings') return `${fmtNum(v)} lettings/qtr`;
    if (isChange) return fmtPct(v);
    return fmtMoneyWk(v);
  };

  const old = (map as any)._rentLayer as L.GeoJSON | undefined;
  if (old) old.remove();
  const typeLabel = st.meta.propTypes.find((t) => t.key === st.typeKey)?.short ?? '';
  const layer = L.geoJSON(geojson, {
    style: (f: any) => {
      const p = bySlug.get(f.properties.slug);
      const v = p ? valueFor(p, st.typeKey, mode) : null;
      return { fillColor: colorFor(v), fillOpacity: v == null ? 0.35 : 0.85, color: '#ffffff', weight: 0.7 };
    },
    onEachFeature: (f: any, lyr: any) => {
      const p = bySlug.get(f.properties.slug);
      const v = p ? valueFor(p, st.typeKey, mode) : null;
      lyr.bindTooltip(`<strong>${f.properties.name}</strong><br>${typeLabel}: ${fmt(v)}`, { sticky: true, className: 'map-tip' });
      lyr.on({
        mouseover: () => lyr.setStyle({ weight: 2, color: '#0f172a' }),
        mouseout: () => layer.resetStyle(lyr),
        click: () => { if (p) openLGA(p.slug); },
      });
    },
  }).addTo(map);
  (map as any)._rentLayer = layer;

  // legend
  const legend = document.getElementById('map-legend');
  if (legend) {
    if (isChange) {
      const stops = [['≤ −20%', '#15803d'], ['−5%', '#4ade80'], ['0', '#cbd5e1'], ['+25%', '#fcd34d'], ['+60%', '#fb923c'], ['+120%+', '#dc2626']];
      legend.innerHTML = `<div class="legend-title">${MODES.find((m) => m.key === mode)!.label} · ${typeLabel}</div>` +
        stops.map(([l, c]) => `<span class="legend-item"><i style="background:${c}"></i>${l}</span>`).join('');
    } else {
      const unit = mode === 'lettings' ? '/qtr' : '/wk';
      const steps = 5;
      let html = `<div class="legend-title">${MODES.find((m) => m.key === mode)!.label} · ${typeLabel}</div>`;
      for (let i = 0; i < steps; i++) {
        const v = min + ((max - min) * i) / (steps - 1);
        html += `<span class="legend-item"><i style="background:${colorFor(v)}"></i>${mode === 'lettings' ? fmtNum(v) : '$' + Math.round(v)}${i === steps - 1 ? unit : ''}</span>`;
      }
      legend.innerHTML = html;
    }
  }
}

export function destroyMap(): void { if (mapInstance) { mapInstance.remove(); mapInstance = null; } }
