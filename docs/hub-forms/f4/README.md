# F4 screenshots — weekly feedback fill and Sunday results

The real components (`src/components/missio/weekly/fill.tsx`, `results.tsx`) rendered at 390 CSS px, 2×, on made-up fixtures (`src/lib/missio/weekly-fixtures.ts`) through the dev-only route `/serve/missio/preview/weekly` (needs `MISSIO_SCREENSHOTS=1`, never served in production). No database was read or written: the dev server pointed Supabase at an unreachable local address.

Matches the approved Brand Guide mockups in `ffsa-hub-forms-ref/mockups/missio/` (`fill.html`, `results.html`).

| File | Screen |
|---|---|
| `fill-390-light.png` / `fill-390-light-fold.png` | Fill, paper, full page and first fold |
| `fill-390-dark.png` / `fill-390-dark-fold.png` | Fill, ink |
| `results-390-light.png` / `results-390-light-fold.png` | Sunday results, paper |
| `results-390-dark.png` / `results-390-dark-fold.png` | Sunday results, ink |

Full-page shots show the sticky send bar at the end of the page (it is set to static for the capture only); the fold shots show it where a phone does.

Overflow check at 360, 390 and 430 px, light and dark, both screens: **12 of 12 pass** (no horizontal scroll, no element past the right edge). Log: `overflow.jsonl`.
