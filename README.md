# Victorian Rents

**26 years of median weekly rents for every Victorian suburb and council — how much it costs to rent, and how fast it climbed.**

🔗 **Live:** [https://vic-rents.benrichardson.dev](https://vic-rents.benrichardson.dev)

## What is this?

Renting is the cost-of-living story of the decade, but the numbers sit locked in dense
government spreadsheets. Victorian Rents turns the Victorian Government's quarterly
**Rental Report** into an explorer: type your suburb and see what it cost to rent — by
dwelling type — every quarter back to 1999, with the inflation-adjusted line beside the
sticker figure.

The typical new lease in Victoria now costs **$550 a week**, up from **$160 in 1999** — a
**244% rise**, and roughly a **65% increase even after inflation**. But the state figure
hides enormous variation: the map, rankings, risers-and-fallers and per-place drill-downs
show where it's dearest, where it rose fastest, and how regional Victoria closed much of
its gap with Melbourne after 2020.

The data measures **new lettings** (rental bonds lodged when someone moves in), so it
reflects the asking market — what you'd pay to move today — not what continuing tenants
pay.

## Who is this for?

Victorian renters and movers deciding where they can afford to live; anyone facing a lease
renewal; journalists and housing advocates who need a citable long-run figure for a
specific suburb or council; and planners comparing councils and dwelling types.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| DFFH Rental Report — Moving annual median rents by suburb | Median weekly rent + lettings count per suburb/town × property type × quarter, 2000– | Quarterly |
| DFFH Rental Report — Quarterly median rents by LGA | Median rent + lettings per council × property type × quarter, 1999–, with Metro/Non-Metro/Victoria totals | Quarterly |
| ABS Consumer Price Index (Melbourne) | Deflator for real (inflation-adjusted) rents | Quarterly |
| ABS ASGS 2024 LGA boundaries | Council polygons for the map | Static |

## Features

- **Suburb finder** — chart any suburb/town/council's rent history by dwelling type; compare several; nominal vs real toggle; deep-linkable.
- **LGA map** — Leaflet choropleth of all 79 councils by rent level or % change, per property type.
- **Risers & fallers** — diverging bars of the biggest rent moves over 1yr / 5yr / all-time.
- **Property types** — how flats and houses diverged; region × dwelling heatmap.
- **Metro vs regional** — the two Victorias and the post-COVID catch-up; a market-weight treemap.
- **Rankings** — dearest, most affordable and fastest-rising councils and suburbs.
- **Explorer** — searchable, sortable table of every place with sparklines and a click-to-filter histogram.
- **Insights** — auto-detected patterns (real-rent rises, places that doubled, the regional catch-up, house-vs-flat premium).
- **real $ toggle** and a full glossary + About panel throughout.

## Tech Stack

- **Runtime:** Vanilla TypeScript
- **Build:** Vite 6
- **Testing:** Vitest (parser + two reconciliation gates + headless render of every view)
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline (quarterly) → JSON in `public/data/`
- **Map:** Leaflet + real ABS ASGS 2024 boundaries

## Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run tests
npm test

# Production build
npm run build

# Preview production build
npm run preview

# Rebuild the dataset from source (downloads the DFFH workbooks)
cd pipeline && npm install && node collect.mjs && node aggregate.mjs
```

## How it works

A quarterly GitHub Actions pipeline downloads the two DFFH Rental Report workbooks (each a
cumulative 25-year time series), parses them with a dependency-free XLSX reader, and
enforces two reconciliation gates on independently-published columns — Metro + Non-Metro
must equal the published Victoria total, and the sum of the individual councils must equal
that total — so a parse error fails the build rather than shipping wrong numbers. It joins
ABS Melbourne CPI (for the real-rent view) and simplified ABS council boundaries, and
writes `meta.json`, `places.json` and `boundaries.geojson`. The static frontend reads those
files and renders everything client-side.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
Data sources keep theirs (DFFH and ABS, both CC BY 4.0), and their attribution requirements
are listed in the site's own About / Sources panel.
