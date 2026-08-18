# Build status — what is actually built, and what is not

Written 2026-08-17, after an audit of `main` against the handoff docs in this
folder. **Read this before starting any redesign work.** It exists because
earlier sessions reported steps as "done" when only part of each step had been
built, and the gap was not visible without checking route by route.

Ground rules learned the hard way:

- **Report against the frame ids in `FFSA Hub Redesign.dc.html`**, not against
  step numbers. "Step 6 done" hid 28 unrecomposed routes.
- **An acceptance sweep is only as wide as the directories it greps.** Say which
  paths were scanned, or the number is meaningless.
- **"Restyle, not rewrite" was the first-pass rule.** It protected live modules
  but left dense screens as old structures in new colours. Rebuilding them is
  the remaining work, not a nice-to-have.

---

## How to run a session (the working agreement)

The failure mode this document exists to prevent: a session takes a whole step,
does the plumbing well, restyles the surfaces partially, and reports the step
"done". Breadth over depth, then a completion claim. To stop that:

**1. One module or one frame group per session. Never a whole step.**
"Rebuild the prayer room" is a session. "Finish the redesign" is not.

**2. Open the design file first.** `design/FFSA Hub Redesign.dc.html`, scroll to
the frame by id. If a session has not looked at the frame, it is guessing.

**3. Definition of done, per frame** — all five, or it is not done:
   - the frame's *structure* is built, not just its palette
   - one `<Masthead>`; content composed from `src/components/ffsa`
   - no `rounded-*`, no `shadow-*`, no dark-theme hex, no `page-title`
   - it renders correctly at 1440px **and** 375px
   - a screenshot of the built screen is put beside the frame

**4. Rebuild, do not restyle.** An earlier pass told subagents to restyle rather
than rewrite dense components, to protect live modules. That was right once and
wrong thereafter: it is why bookings' calendar and every prayer-room tab are old
structures in new colours. If a frame implies a different structure, build the
different structure.

**5. Report by frame id, with evidence.** "8a done" means nothing on its own.
Say which paths were scanned by any acceptance grep — a sweep is only as wide as
its arguments, and quoting "0 dark hexes across 154 files" while 28 routes went
unscanned is how this went wrong before.

**6. Update this file at the end of every session.** Move rows from *not built*
to *built*. If it is not recorded here, the next session cannot trust it.

**7. Never report a step complete.** Report frames complete, and name what in
that step is still outstanding.

---

## Merged and live

Everything below is on `main` and deployed (PR #212, commit `aa53496`).

| Area | State |
|---|---|
| Token layer, Tailwind config, fonts | ✅ complete |
| `src/components/ffsa/` primitives | ✅ complete |
| App shell — 74px rail + 212px bone panel, real initials | ✅ complete |
| shadcn override layer (`data-slot` attributes) | ✅ fixed — the overrides were entirely inert before |
| Dashboard (2a), Events (3a), Training (3b), Finance (5a), Communications (5b), Login (4b) | ✅ recomposed |
| Bookings (3c) — page chrome | ✅ 15 routes |
| Event capacity, campaign open/click, finance ledger, bookings day strip | ✅ built (migrations 174, 165) |
| Prayer room data model + wall (8a) | ✅ migrations 175, 168–171 applied |
| Billing: `billing_mode` (172), generation guard + held-charge queue (173) | ✅ with tests |
| Xero: read side, honest status, per-region org pinning | ✅ |

---

## Not built — the real backlog

### Prayer room — 1 of 5 UI stages
`06-screen-recipes.md` lists five stages. Only the wall exists. **Zero masthead
references across all 19 files in that module** — the page header, tabs and four
of five tabs are the pre-redesign screens.

| Frame | State |
|---|---|
| 8a wall | ✅ |
| 9a set detail drawer (470px, source block inverts to black), 9b claim flow | ❌ still the old dialog |
| 10a/10b seats + **People tab** | ❌ no People tab exists |
| 11a person profile, 11b mobile | ❌ "My Seats" is a plain panel, not the designed profile |
| 12a/12b evaluators portal as its own tab | ⚠️ queue + band curation bolted into the existing Evaluations tab |
| 13a/13b two-note evaluation | ✅ roughly per design |

The backend is complete and verified end to end, so this is UI work against a
working data layer.

### `08-training-and-messages.md` — nothing built
The whole document. Note the handoff's own warning: Messages is the thing every
later feature sends through, and billing's email moments (07 §10) depend on it.

- 14a school detail: 300px phase run + roster table (student · from · status ·
  walking with · fees · graded)
- 14b grades matrix — ungraded cells stay empty white
- 14c applicant review — answers at 15px/1.5, decision bar pinned outside scroll
- 15a form builder — one readable list, conditionals indented with a yellow pill
- 15b/15c Messages — **needs tables `school_message_moments` + `message_sends`**;
  `source` column drives FFSA DEFAULT / THIS SCHOOL and makes revert possible
- 16a student mail, 16b/17b compose drawer, 17a/17b bulk (N separate emails)

### `07-finance-billing.md` — 9a and 9b only
Remaining: 9c (dry run → create → send as three steps; Xero webhooks; three-tier
matching; reconciliation inbox), 9d (prepay, the four transitions, approval
matrix, adjustments, refunds), 9e (student fees tab 27a, portal fee view 24a),
§10 email moments, debtors (26a), copy-to-next-intake (21d).

### Recipe items never started
- Module panel extras: saved views as stacked chips (Events), audience segments
  with counts (Communications).
- Dashboard bottom strip: support raised with a Bar, plus a photo tile.

### 4c public event page — ✅ built (session 7)

`src/app/(public)/e/[slug]/ffsa-storefront.tsx`, rebuilt (not restyled) onto
the editorial system. Scanned path: `src/app/(public)/e/[slug]/`.

Black top bar · full-bleed masthead with the 0.35→0.94 scrim and a
`clamp(46px, 10.5vw, 118px)` condensed title · facts strip of bone cells ·
body copy left with the registration form inline right at 520px · black
footer. Verified at 1440px and 375px, no horizontal overflow at either.

Three things a later session should know:

- **The masthead photo has no column to read.** 4c calls for a full-bleed
  photo; `events` has only `logo_url`, which is a brand mark, not a cover.
  The photo layer is built and wired to a `heroImageUrl` prop that is
  deliberately not passed — the masthead renders on its black ground until
  an `events.hero_image_url` column exists, at which point it is one line in
  `page.tsx`. No migration was taken (session 7 was not allocated one).
- **Every figure on the page is derived from that event's own tiers.** The
  frame's headline numerals are marketing copy; the build computes seats
  taken, days to go and tier count from `quantity_sold` / `capacity` /
  `max_capacity`, and renders nothing where a figure cannot be computed.
  Do not reintroduce the frame's literal numbers.
- **`globals.css` has an app-wide `label { … !important }`.** It puts every
  label into 9.5px mono caps, which is right for admin screens and wrong for
  a public page carrying sentence-length questions and consent text. The
  storefront opts out inside `.ffe` rather than touching the shared rule.
  The same rule is still flattening consent labels on the five bespoke
  storefronts — pre-existing, not introduced here, worth a look.

The five bespoke event brands (the_send, ffsa_camps, preachers, wild_ones,
missio) were not touched; verified Wild Ones still renders its own kit.

### 4d mobile portal — ⚠️ partly built (session 7)

Built: `src/components/mobile-tab-bar.tsx` — four items (School · Finance ·
Prayer · Me), 48px minimum targets, active tab the only yellow thing on
screen, `env(safe-area-inset-bottom)` so notched phones don't clip the
labels. Wired into both the `(portal)` and `(admin)` layouts with `pb-20` on
phones so the last row clears it. The hamburger drawer stays for Operations
and System — the bar is the shortcut to the four personal destinations, not
a replacement for the full menu.

Recomposed onto the system, each with one big numeral and two-line rows:
my-finance, my-schools, my-events, my-attendance, my-history, my-mission.
The `(portal)` layout now runs edge-to-edge like the admin one.

Still on the old design in `(portal)`: `profile`, `my-schools/[enrollmentId]`,
`my-schools/apply/[programId]` (+ its form), `my-finance/outreach/[teamId]`,
and `my-finance/school-fees-card.tsx`. The prayer-room half of 4d belongs to
session 1 and was left alone.

### 28 admin routes still on the old design
Old header (`page-title`): contacts (8), users (2), teams, settings, org-chart,
mission, ministry, consents.
Never touched: prayer-room, records-library (6), roles, permissions,
contacts/import, event form builder, ministry detail.

Contacts and users are the highest-traffic of these.

---

## Decisions already taken — do not re-litigate

- **Yellow**: one `<NeedsYou>` band per screen. Hairline yellow ticks (masthead
  rule, lead-KPI mark) are structural accents and may coexist. `Kpi tick={false}`
  where they would compete.
- **Event brand kits are out of scope** — storefronts, email templates, brand
  editors keep their own fonts and colours. Bebas/Anton/Space Mono stay loaded
  for them.
- **Prayer room**: instrument labels stay as labels; qualifications govern seats.
  Legacy evaluation notes are private. The wall replaces the week/day views.
  Clash detection: DB trigger stays the backstop, the picker surfaces the clash.
- **Billing**: a scheduled charge is not an invoice. No hardcoded dates. Never a
  past-dated invoice. Create and send are separate. Deposit refundability is
  stored config, not a constant. Flights/visas are not deducted. US students are
  always tier A, so the "16 missing US tier B/C codes" is NOT a gap.
- **Both schools stay `billing_mode = external`** until opening balances exist —
  they are mid-payment outside the Hub, so switching them on would re-invoice
  students.

---

## Migration numbering

`main` and feature branches have collided twice (116, then 164 + 167). Two files
here were **applied as 164/167 but are named 174/175**; their headers say so.

**Next new migration: 176.** Always branch off `origin/main` and check
`ls supabase/migrations | sort | tail` first.

---

## The design file IS here now (added 2026-08-17)

`docs/redesign/design/FFSA Hub Redesign.dc.html` — open it in a browser and work
from the frames. Its `brand/`, `icons/`, `support.js` and `image-slot.js` sit
beside it, so it renders standalone. (The 40MB `uploads/` folder from the
original bundle — brand deck PDF, screenshots — is deliberately NOT in the repo;
it is source material the file never references.)

**It contains 91 frames, 0a → 31e.** Cite these ids in every report.

## Two more design turns arrived with it, previously undocumented

The bundle's `handoff/` folder held two docs no earlier session had, now in this
folder. They cover frames 28a–31e — roughly twenty frames that were invisible to
every earlier plan:

- **`10-outreach-budget.md`** (28a–28f) — one outreach budget, importing the real
  spreadsheet, who owns it and who may touch it, planned vs spent, every receipt
  in one place.
- **`11-communications.md`** (29a–31e) — and its own header says: *"This module is
  the backbone every other module sends through, so build it before adding more
  modules on top of it."* One `messages` table for everything the Hub sends, with
  a `reason` column written at send time ("She is in DTS 26-2 students") — the
  difference between apologising blindly and knowing what fired. Then newsletters,
  saved audiences, per-person email history, bounce handling, replies, POPIA
  subject requests (what we hold / correct / delete), and self-running sequences.

The README in this folder is the newest version and adds **Step 10** and
**Step 11** accordingly.

### What that does to the ordering

`11-communications.md` supersedes the "Messages" half of `08-training-and-messages.md`
(its `school_message_moments` / `message_sends` sketch is the narrower, earlier
version). Build the `messages` model from doc 11 first — billing's email moments
(07 §10), school moments (08 §5) and campaigns all sit on top of it.

Numbering note: design docs own 05–11. Analysis written by earlier sessions moved
to **90–92** so it cannot be mistaken for a design brief.
