# Site Plan: Victorian Rents

## Overview
- **Name:** Victorian Rents
- **Repo name:** vic-rents
- **Tagline:** 26 years of median rents for every Victorian suburb and council — how much it costs to rent, and how fast it climbed.

### Naming Convention
Sub-national scope (Victoria only), so the name is qualified — "Victorian Rents" — the same call as `nsw-pokies`. There is no national "Rents" site to disambiguate against, but calling a Victoria-only dataset just "Rents" would be misleading. The index entry carries `country: AU`.

## Target Audience
Victorian renters, prospective movers, and first-home hopefuls deciding where they can afford to live; journalists and housing advocates who need the long-run number for a specific suburb; anyone arguing about "how bad the rental crisis really is". Primary device is a phone, often anxious/frustrated context ("can I afford to move to X?"). Secondary: policy/planning people on desktop comparing councils and property types.

## Value Proposition
Nowhere free lets you type your suburb and instantly see 26 years of what it actually cost to rent there — by dwelling type — with the real (inflation-adjusted) line beside the sticker figure. Real-estate portals show today's asking rents; this shows the *government's* moving-median of actual new lettings, back to 2000, for every suburb and council, with rankings, a map, and the biggest movers. Bookmark-worthy because rent is checked repeatedly and the history is impossible to assemble by hand.

## Data Sources
| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| DFFH Rental Report — Moving annual median rent by suburb | discover.data.vic.gov.au dataset `rental-report-quarterly-moving-annual-rents-by-suburb` (latest XLSX via dffh.vic.gov.au redirect) | Median weekly rent + lettings count per suburb/town × property type × quarter, Mar 2000→ | Quarterly (~5-month lag) | No |
| DFFH Rental Report — Quarterly median rents by LGA | discover.data.vic.gov.au dataset `rental-report-quarterly-quarterly-median-rents-by-lga` (latest XLSX) | Median weekly rent + lettings count per LGA × property type × quarter, Jun 1999→, with Metro/Non-Metro/Victoria total rows | Quarterly | No |
| ABS CPI (All groups, Melbourne) | data.api.abs.gov.au SDMX dataflow CPI | Quarterly index to deflate rents to real terms | Quarterly | No |
| ABS ASGS 2024 LGA boundaries (VIC subset) | geo.abs.gov.au ArcGIS / Digital Atlas | Council polygons for the choropleth (simplified, vendored) | Static | No |

Both DFFH workbooks are **cumulative time-series files** — the single latest file per dataset already contains the whole history, so the pipeline fetches just the two latest XLSX (resolved via the data.vic CKAN API by newest resource) plus one small CPI series. DFFH data is CC BY 4.0; ABS CC BY 4.0.

## Key Features
1. **Suburb finder** — type any suburb/town, chart its rent trajectory by property type over 26 years; compare several; nominal vs real (CPI-adjusted) toggle; deep-linkable (`#suburb=...`).
2. **LGA map** — Leaflet choropleth of all 79 councils: current median rent, or % change over 1yr / 5yr / since-2000, or lettings volume, per property type; per-council drawer.
3. **Risers & Fallers** — diverging ranked bars of % rent change over a selectable window, suburb or LGA scope, per property type — the crunch, made visible.
4. **Property types** — how 1-bed flats vs 3-bed houses etc. diverged over time; current premium/gap; region × type current-rent heatmap.
5. **Metro vs Regional** — the two Victorias: the long-run gap and the post-COVID regional catch-up; region → suburb hierarchy treemap of lettings volume.
6. **Rankings / leaderboard** — most & least expensive councils and suburbs now, fastest-growing, vs the Victoria median, per property type.
7. **Explorer** — searchable/sortable table of every suburb and LGA with sparkline, current rent, % changes, lettings; a click-to-filter distribution histogram.
8. **Insights** — auto-detected: suburbs that more than doubled, regional catch-up, supply-thin areas (low lettings), property-type premium shifts.
9. **Real-rent everywhere** — a nominal/real toggle so growth isn't overstated by inflation (rents still rose far faster than CPI — that's the point).

## Target Audience (detailed)
Renters aged ~20–45 on phones, often stressed and comparison-shopping suburbs or bracing for a lease renewal; they want a fast, trustworthy number and a sense of the trend, not a spreadsheet. Housing journalists and advocates on desktop who need a citable long-run figure and the biggest-mover framing. Planners/policy on desktop comparing councils and property types. All non-expert in "moving annual median" — heavy glossary + about needed.

## Style Direction
**Tone:** civic / consumer — trustworthy and calm, not alarmist, but honest about the climb.
**Colour palette:** light, warm-neutral paper background with a considered teal→amber accent; rent *levels* on a sequential warm ramp, rent *change* on a diverging green(down)→amber→red(up) ramp. Reads like a good public-service housing portal, not a terminal.
**UI density:** balanced — generous on the finder/overview (consumer), denser on the explorer/rankings (data).
**Dark/light theme:** light (civic/consumer), with a system-dark variant for the app shell.
**Reference sites for tone:** fuelaustralia.org (clean utility), the ABS data explorer (authoritative but readable); the fleet's au-inflation and au-income for the "look up an item / rebased comparison" pattern.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite (single-page, tabbed views, one map — no need for React).
- **Data strategy:** pipeline — quarterly cron (proportional to DFFH's quarterly release), staggered day/minute; embeds the latest data quarter, not a run timestamp, so re-runs are idempotent.
- **Key libraries:** Leaflet (LGA choropleth) + `@types/leaflet`. Everything else hand-rolled SVG (lines, bars, diverging bars, treemap, histogram, sparklines) from `patterns/`.

## Layout
Fixed light header (title + view tabs + property-type selector + nominal/real toggle + `?` about). Main content fills below; sticky footer with attribution + directory backlink. Views stack to a single column < 768px; the map is a large panel with an isolated stacking context; drawers slide in from the right and detach from the DOM when closed (iOS scroll-safe). Max-width ~1600px for the dense views.

## Pages/Views
Single page, hash-routed tabs: Overview · Map · Suburb finder · Risers & Fallers · Property types · Metro vs Regional · Rankings · Explorer · Insights. Plus hash-linkable per-suburb (`#suburb=`) and per-LGA (`#lga=`) drawers and an About modal.

## Visualization Strategy
The data shape is **place × property-type × quarter**, a 26-year panel of medians and lettings counts — temporal + geographic + categorical. Chosen forms are proportional to that shape:
- **Multi-line rebased trajectory** (Suburb finder) — *how did rent here change, and vs other suburbs?* The right form for a long ranking/level time series; nominal/real toggle; zoom/pan. Answers the #1 user question.
- **LGA choropleth map** (Leaflet + real ABS boundaries) — *where is it expensive / rising fastest?* Level and diverging-change modes; the only honest geographic view (suburb groupings are DFFH composites without clean boundaries, so the map is LGA-level and the suburb data drives search/rankings — stated plainly).
- **Diverging ranked bars** (Risers & Fallers) — *who moved most?* Green-down / red-up, the crunch as a spread not a single number.
- **Small-multiples / divergence lines** (Metro vs Regional) — *the two Victorias* and the regional catch-up; a form a single line can't show.
- **Region→suburb treemap** (`patterns/treemap.ts`) — *where the lettings volume actually is* (market weight), colour-by-rent or by-change, drill region→suburb.
- **Region × property-type heatmap** (Property types) — *which type is dear where*, a matrix the bars can't.
- **Sortable table + click-to-filter histogram** (Explorer) — *distribution of current rent / change* with drill to any place.
- **Sparklines** in tables/drawers; **line + annotations** on the Overview (GST 2000, COVID 2020–21 dip, 2022–25 surge).
- Every mark: `[data-tip]` hover tooltip with exact $ + quarter + count; map layers use `bindTooltip`. Litmus test met — these views would look wrong for any non-rent dataset (the metro/regional catch-up, the property-type premium, the suburb composites) rather than being house-default charts.

Reconciliation gates (independently-published columns, so agreement proves a correct parse):
1. **Exact:** for every quarter × property type in the LGA file, Metro count + Non-Metro count == the published Victoria total count (verified 106/106 quarters, 0 mismatches). A column shift breaks it; a test deliberately shifts a column to prove the gate fails.
2. **Exact:** for every quarter × property type, the sum of the individual LGA lettings counts == the published Victoria "Table Total" count.
3. **Soft/sanity:** each suburb's "All properties" lettings count ≥ the sum of its six named-type counts (All includes bedsits, 1-bed houses, 4+ flats), asserted as a bounded ratio, not equality.
