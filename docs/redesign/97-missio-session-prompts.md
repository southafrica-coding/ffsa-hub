# Missio — session prompts

One session per block, one PR per session, branch off the latest `origin/main`, never merge
your own PR. Read `CLAUDE.md`, `CONTRIBUTING.md`, `docs/ui-polish-checklist.md`,
`96-missio-reconciliation.md` and the boards named in the block before writing code. Open
`docs/redesign/design/Missio.dc.html` in a browser for the boards. Never run the Supabase or
Vercel CLIs. Migrations are applied by hand; say so in the PR.

**Before session 1:** merge (or close) the open Missio branches in the order in
`96-missio-reconciliation.md` §2. Sessions 2+ assume they are on `main`.

Pre-assigned migrations (re-check `ls supabase/migrations | sort | tail` first):
S3 → 334 · S5 → 335 · S6 → 336 · S7 → 337 · S8 → 338 · S9 → 339 · S10 → 340 · S11 → 341.

---

## S1 — Missio tokens, shell and tab bar (M1a, M1b, M1c, M11a menu) · no migration
Move the M1a colour, radius, shadow and type values into one shared token block for the
Missio layout and point the existing CSS modules at it. Fix the three contrast changes
(quiet text `#6E685B`, terracotta text uses `#8E3D1F`, gold never text). Add the phone bottom
tab bar (Home · People · Houses · Sundays · Follow-up) alongside the drawer. Menu per M11a,
only linking to routes that exist; everything else stays out (no placeholder pages).
Done when: 360/390/430px have no horizontal scroll, focus rings visible, existing tests pass.

## S2 — People profile + journey (M2a–M2c) · no migration if events can be derived
Restyle the directory to M2a/M2b (filter sheet, states). Build the profile and the journey
timeline from data that already exists (connect cards, follow-up stage changes, house
memberships). If a `journey_events` table is needed, stop and propose it — do not add it here.

## S3 — Coaches + house churches map (M3a–M3c, M4d, M4e) · migration 334
Add coach assignments (coach ↔ house or team). Build the top-down map exactly as M3a
(coach row → houses → tray; one branch open; open path in terracotta; people-dots out of 24,
adults only), the six signals, phone map M3b, restyle the grid and house page.

## S4 — Import review queue, connect card, follow-up restyle (M4c, M5a–M5c) · no migration
Restyle the existing screens to the boards. Add the consent line to the connect card (use
the existing consent ledger). Needs-review compare card per M5b.

## S5 — Roles: leader, co-leader, coach (M10a–M10c) · migration 335
Implement the M10c table as RLS with SQL tests. Leader and coach home screens. Phone-number
sign-in is a separate decision — ask before changing auth.

## S6 — Weekly house feedback (M4a, M4b) · migration 336
Public per-leader link, form, history with gap-not-zero charts. Links are copied by hand
until WhatsApp (S8) exists.

## S7 — Placement pipeline + next-steps page (M12a–M12c) · migration 337
`placements` with the four steps, tracker, the person's public page, leader "said hi" /
"came" actions. Messages are `wa.me` drafts until S8.

## S8 — WhatsApp Cloud API + automatic messages (M11d, M13) · migration 338
Meta templates, send log, webhook, quiet hours, STOP. The message card with "Edit message"
on every send screen. Needs the env vars in reconciliation §5 — stop if they are not set.

## S9 — Planning Center: link, Sundays read-only, service feedback (M11c, M9a–M9c) · 339
Read-only first. Verify each endpoint in Planning Center's docs before using it.

## S10 — Serving funnel + availability blockouts (M8a–M8d, M6) · migration 340
The only two writes to Planning Center. Queue and retry every write.

## S11 — Households, care, next leaders, multiply, family tree (M14a, M14b, M12d, M11b, M12e) · 341
Reuse the existing households model. Multiplication writes a frozen snapshot.

## S12 — Monthly report + Monday briefing (M14c, M14d) · needs S8
