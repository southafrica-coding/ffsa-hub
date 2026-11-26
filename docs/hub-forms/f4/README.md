# F4 screenshots — weekly feedback fill and Sunday results

The Brand Guide screenshots that were here are gone: the fill and results were
restyled to the Missio design (board M4a in `docs/redesign/design/Missio.dc.html`,
tokens in `src/components/missio/missio-tokens.css`). Missio has no dark page
theme, so there is no dark variant any more.

To capture them again, run the dev-only route `/serve/missio/preview/weekly`
(and `?screen=results`) with `MISSIO_SCREENSHOTS=1` at 390 px. It renders the real
components on the made-up fixtures in `src/lib/missio/weekly-fixtures.ts`, with
no database.
