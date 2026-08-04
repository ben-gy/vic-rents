# Victorian Rents — Build Review

This file exists only to create a reviewable PR. All code is already deployed on `main`.

**Merge this PR to acknowledge the build.** Closing without merging is also fine.

## Links

- **GitHub Pages:** https://ben-gy.github.io/vic-rents/ *(redirects to the custom domain once DNS is set)*
- **Custom domain:** https://vic-rents.benrichardson.dev

## What it is

An explorer for the Victorian Government's quarterly **Rental Report**: median weekly rent
for every Victorian suburb (146) and council (79), by dwelling type, every quarter from
1999 to 2025 — with a real (inflation-adjusted) toggle, an LGA choropleth, a suburb finder,
risers-and-fallers, rankings, an explorer and auto-detected insights.

Headline: Victoria's typical rent went from **$160/wk (1999) to $550/wk (2025)** — up 244%,
and ~65% even after inflation.

## DNS setup (already applied)

| Type | Name | Target | Proxy |
|------|------|--------|-------|
| CNAME | `vic-rents` | `ben-gy.github.io` | DNS only (grey cloud) |

If the cert needs re-triggering:
```bash
gh api repos/ben-gy/vic-rents/pages -X PUT -f cname=""
sleep 3
gh api repos/ben-gy/vic-rents/pages -X PUT -f cname="vic-rents.benrichardson.dev"
```
