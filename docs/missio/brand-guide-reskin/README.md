# Missio — MissioSA Brand Guide reskin, screenshots

Phone-width (390 px) captures of the existing Missio pages after the reskin, on
both grounds. `*-fold.png` is the first screen; the file without `-fold` is the
full page.

| Screen | Route |
| --- | --- |
| home | `/missio` |
| house-churches | `/missio/house-churches` |
| care-board | `/missio/care` |
| follow-up | `/missio/follow-up` |
| next-leaders | `/missio/next-leaders` |
| volunteers | `/missio/volunteers` |
| connect | `/connect/missio` |
| care-form | `/serve/missio/care` |
| availability | `/serve/missio/preview?state=filled` |

Sources: `Brand Guide.dc.html` (MissioSA, Nov 2026) and the approved mockups in
`ffsa-hub-forms-ref/mockups/missio/`.

## How these were made

A local copy of the branch ran `next dev` with `/missio` opened up and every
`/api` call answered from stub fixtures. Fake Supabase env, no database, no
network writes. Each screen was also checked for sideways overflow at 360, 390
and 430 px, light and dark. All passed (`scrollWidth == clientWidth` on the
page and the content column).

Home, follow-up and availability were re-shot after the last fixes (sage
chart bars, the follow-up select on the ink ground, availability dark); the
rest are from the first pass. All data is made up.
