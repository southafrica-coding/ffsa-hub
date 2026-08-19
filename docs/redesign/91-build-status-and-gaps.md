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
| Bookings (3c) — **the timeline itself, rebuilt** | ✅ now the Spaces day view — see the 3c section below |
| Event capacity, campaign open/click, finance ledger, bookings day strip | ✅ built (migrations 174, 165) |
| Prayer room data model + wall (8a) | ⚠️ migrations 175, 168, 169, 170 applied — **171 is NOT** (see below) |
| Prayer room UI — masthead, 9a, 10a, 10b, 11a, 12a, 12b | ✅ merged 2026-08-18 (PR #226, `87cae22`) — no migration |
| Billing: `billing_mode` (172), generation guard + held-charge queue (173) | ✅ with tests |
| Xero: read side, honest status, per-region org pinning | ✅ |

---

## 3c — bookings timeline, rebuilt (2026-08-18), then split (same day)

The calendar was the "restyled, not rebuilt" case this file called out. It has
been rebuilt to 3c's structure — 230px resource column, black hour header, hour
columns as gridlines, blocks positioned by percentage, requests waiting on
approval underneath — reusing `blockWindow` / `packLanes` / `computeHourRange`
from `src/lib/bookings/timegrid.ts`.

Paths scanned by every acceptance grep below: `src/app/(admin)/bookings` — the
whole module. Numbers quoted from any narrower sweep are worthless.

### 3c's unified grid was reversed by product decision

**Read this before "restoring" the frame.** 3c draws spaces AND vehicles on one
timeline so cross-service clashes are obvious. That shipped (PR #223) and was
then deliberately undone (PR #224) on Jack's instruction:

> "the spaces needs to be its own visual thing and the vehicles doesn't need to
> be a visual thing it just needs to be a portal for the vehicle rental process"

The reasoning is that the two are not the same kind of thing. A space is a
timetable — hours, clashes, a day you scan. A vehicle is a rental process —
request, approve, collect, inspect, return. Forcing the second into lanes made
it look like a timetable it never was, and every vehicle block was all-day
anyway (the schema is date-only), so the lanes carried no time information.

What this costs, stated so nobody rediscovers it as a bug: there is no longer
any screen where a space clash and a vehicle clash are visible together. Vehicle
double-booking is caught by `getOverlappingAssignments` at assignment time, not
visually.

### Where things live now

| Route | Shape |
|---|---|
| `/bookings` | A hub: a list of what there is to book, gated per module. No visualisation. |
| `/bookings/spaces` | The 3c day timeline, venues only, and **the landing view** — month / week / list sit behind the switcher. |
| `/bookings/vehicles` | The rental portal, unchanged. Never a timeline. |

Files: `spaces/day-timeline.tsx` (the grid), `spaces/day-board.tsx` (lanes +
approvals for a day), `spaces/approval-queue.tsx` (the strip). `spaces/day-view.tsx`
is deleted — the timeline replaced it.

Because the day view is now the landing view, it takes **pending as well as
approved** bookings (month / week / list still take approved only). A pending
request clashing with a confirmed one is exactly what that screen is for. The
day view carries its own per-day approvals strip; the module-wide `NeedsYou`
band is suppressed there and kept on the other views, so the same thing is not
said twice — the strip's meta says "on this day" to keep the two scopes distinct.

### The approval rule, now visible

`venues.requires_approval` (migration 097) already worked end to end — the API
honours it, the booking form previews it — but it was an unlabelled tickbox in a
cramped row. `/bookings/spaces/venues` now states both sides:

- **Instant book** (the column default, `false`) — confirms itself, no manager.
  A clash is **refused outright** (409), because nobody is there to catch it.
- **Needs approval** — held as pending; a clash is shown to the manager as a
  warning rather than refused. Managers still auto-confirm their own bookings.

The section bar counts how many spaces are held ("3 of 7 need approval"), and
the add-row says new spaces are instant book. No migration — this is surfacing,
not new capability. Copy was checked against `src/app/api/bookings/route.ts`
rather than written from the field name.

### Deviations from the frame, stated plainly

1. **SHOWING (all / spaces / vehicles) is gone**, along with the unified grid it
   filtered. Nothing left to filter between.
2. **Deny is not on the approvals strip.** The frame shows only APPROVE; deny,
   notes and clash detail stay in the full review queue.
3. Every active venue gets a lane, booked or not — a free room has to be visible
   on a screen whose job is "can I have this room at 3". Quiet days are a list of
   FREE rows by design.

### Not done

- The spaces **month / week / list** views (`booking-calendar.tsx`,
  `week-view.tsx`, `time-grid.tsx`) are still restyled-not-rebuilt. No frame
  specifies them.
- `vehicles-view.tsx` and the vehicle forms are untouched.

### Verification

Signed in, against the real database, at 1440×1000 and 375×812:

- `/bookings` — hub, two cards, each labelled with its shape.
- `/bookings/spaces` — lands on the day timeline, venues only.
- `/bookings/spaces?date=2026-08-31` — a timed booking (Office 2, 09:35–21:55)
  stretches the hour range to 21 and positions correctly.
- `/bookings/spaces?view=month` — month view intact.
- `/bookings/spaces/venues` — approval control flips state and arms Save.
  **Not saved**: that would have rewritten live booking policy.

Neither width scrolls the page horizontally; the grid scrolls inside itself.

### Bug found in prod and fixed: "next day" did nothing (2026-08-19)

Reported by Jack against the live site. On the Spaces day view the back arrow
worked and the forward arrow did nothing.

Cause: **the href was shortened by comparing against a clock the server does not
share.** `buildHref` omitted the `date` parameter when it equalled "today", to
keep the URL tidy. But the page renders on the server — UTC on Vercel — while
the button that builds the link runs in the browser, on SAST. Between 22:00 and
midnight those are different days. The server rendered the 18th; the browser
believed today was the 19th; "next day" computed the 19th, matched the browser's
today, dropped the parameter — and the server answered with the 18th again.

Two hours a night, on a screen whose whole job is picking a day, and invisible
in every test and every daytime click-through.

Fixed in two places:

- `src/lib/bookings/nav.ts` — `buildSpacesHref` now always writes the date.
  It is a separate module specifically so it **cannot see `today`**: the
  shortcut is not merely removed, it is unavailable. `nav.test.ts` pins the
  case.
- The landing day is corrected too. With no `?date`, the server picks *its*
  today, so the same viewer was being shown yesterday's schedule on arrival.
  The view now replaces the URL with the browser's day, but only when the
  viewer named no date, so it can never override a deliberate choice.

**The general rule for this codebase: any "is this today" comparison that spans
a server render and a client click is comparing two clocks.** Server components
make this easy to write and impossible to notice.

### Correction to the previous entry

The 2026-08-18 acceptance sweep reported "0 `rounded-*`". That was true only of
the hyphenated form. **17 bare `rounded` classes existed** in the module and were
not counted — exactly the kind of narrower-than-it-sounds number this document
exists to prevent. `venue-admin.tsx` is now clean; **12 remain**, all in the
vehicle forms (`inspection-form`, `vehicle-booking-form`, `agreement-form`,
`fleet/fleet-admin`), which no frame has covered yet.

Grep both forms: `grep -rn '\brounded\b' src/app/\(admin\)/<module>`.

## Not built — the real backlog

### Prayer room — UI

Session of **2026-08-18** (branch `redesign/prayer-room-ui`, off `origin/main`
at `1525867`). No migration: the data layer for all of this was already applied
(168–171, 175), so this was UI against a working backend.

| Frame | State |
|---|---|
| 8a wall | ✅ (plus: the open block now stays outlined behind the drawer) |
| 9a set detail drawer | ✅ rebuilt as a 470px right drawer with ↑PREV / NEXT↓ |
| 9b claim flow (curated-band + empty-space states) | ❌ not attempted |
| 10a People tab | ✅ built — replaces the old Directory |
| 10b lineup / fill a seat / requests to join | ✅ all three panels |
| 11a person profile | ✅ built, its own screen with a breadcrumb |
| 11b prayer room on a phone | ❌ not attempted — and it is NOT a profile layout, see below |
| 12a evaluators portal as its own tab | ✅ own tab, gated on `prayer_room.evaluate` |
| 12b band curation + note privacy | ✅ both panels |
| 13a/13b two-note evaluation | ✅ unchanged, now opened from the 12a queue |

**Module masthead: was zero references across 19 files, now every tab renders
one.** `<Masthead>` + a mono `<ModuleTabs>` strip live in
`prayer-room/components/chrome.tsx`; each tab renders it (only one tab is
mounted at a time, so the one-masthead-per-screen rule holds) because the
context line, actions and filters all belong to the tab.

New in `src/components/ffsa/`: `Drawer`, `ModuleTabs`, `MastheadButton`.
The drawer is portalled to `<body>` — the admin shell's content column carries
`animate-fade-up`, and a transform on an ancestor makes it the containing block
for `position: fixed`, which sized the drawer to the whole scrolled page and
pushed its footer below the fold.

New reads: `services/prayer-room-people.ts`, `/api/prayer-room/people`,
`/api/prayer-room/people/[userId]`, `/api/prayer-room/evaluators`.
`/api/prayer-room/requests` now resolves names with the admin client — `users`
is own-row-or-admin under RLS, so the embedded join returned a null person for
everyone except the caller and every row in a lead's inbox read "Unknown".

**Deleted:** `directory.tsx` (superseded by People), `seat-evaluations.tsx`
(superseded by the 12a queue).

#### What 11b actually is

Worth stating, because the row above used to say "mobile person profile" and
that is wrong. **11b is three 390x844 phone screens plus a bottom tab bar** —
the day as a vertical run (the week grid does not survive a phone), a set's
lineup, and MINE (seats you asked for, your qualifications). The bar is
WALL / MINE / PEOPLE / ALERTS. It is the same work as the backlog's
"Mobile portal (4d / 11b)" item, not a variant of 11a, and its day screen
carries a full-width TAKE IT on every gap — which is **9b's claim flow**, also
unbuilt. Build 9b first or the mobile day screen has a dead primary action.

#### Deliberately not built, and why

- **"I'm coming" (9a footer)** — there is no attendance model, only seats. The
  footer is ADD TO CALENDAR (a real `.ics`) + SHARE instead. Needs a table.
- **"Hand over" (9a footer)** — no endpoint transfers ownership of a set.
- **"Turned up 21/22" (11a KPI)** — same missing attendance model. That cell is
  SEATS SIGNED OFF instead, which is real.
- **"+ Book a session" as a masthead action (12a)** — booking is per request
  (`prayer_room_evaluation_requests.scheduled_at`); a standalone one has nothing
  to attach to. Per-row "Book a session" is built and does write `scheduled_at`.
- 12a's queue states are **derived**, not stored: `booked` → READY, no seats ever
  held → TOO EARLY, otherwise NEEDS A SESSION.
- 10a's seat-category chips sit in the bone filter strip under the tab rule
  rather than on the rule itself — the strip is the system's existing filter row
  (Events uses it) and it survives 375px.

#### Migration 171 was never applied (found 2026-08-18)

This file said "migrations 175, 168–171 applied". **171 is not.** Probed
directly against production:

    prayer_room_seat_types            OK   (167/175)
    prayer_room_qualifications        OK   (168)
    prayer_room_evaluations           OK   (169)
    prayer_room_seat_requests         OK   (170)
    prayer_room_evaluation_requests   OK   (170)
    prayer_room_template_blocks       OK as a table, but band_name /
                                      is_curated / weekly_focus DO NOT EXIST
                                      -> 42703, so 171 never ran

**Why nobody noticed for a whole session.** `/api/prayer-room/wall-meta` wraps
its reads in a `safe()` helper that turns any error into `[]`, so a missing
COLUMN and an empty TABLE are indistinguishable to every caller. The wall drew
no bands, the 12b panel showed "no band is curated yet", and both looked like
"nobody has set the bands up" rather than "the migration is missing". That
graceful degradation was deliberate — the module has to render on a database
partway through its migrations — but it hides a real schema gap. Worth making a
schema error distinguishable from empty data, at least in development.

The lesson this file already carries, applied to itself: a "migrations applied"
row is a claim like any other, and the only way to know is to ask the database.

**Until 171 is applied**, `+ SET UP A BAND` returns
`Could not find the 'band_name' column` and the wall can never draw an anchor.

#### The wall drew no MORNING / NOON / NIGHT (fixed 2026-08-18)

Reported after the merge, and it was two faults at once:

1. **No data, and no way to make any.** Migration 171 added `band_name` and
   `is_curated` to `prayer_room_template_blocks` but seeded nothing — its own
   header carries the intended `UPDATE ... SET band_name = 'MORNING'` as a
   commented-out manual step. So zero rows were curated and the wall had nothing
   to draw. Worse, 12b's panel could only *edit* bands: its empty state told you
   to "mark a weekly template block as `is_curated`", which no screen in the Hub
   could do. `POST /api/prayer-room/template` now accepts `band_name` /
   `weekly_focus` / `is_curated` (RLS still decides — insert is staff-only,
   editing a band stays open to evaluators), and the 12b panel has **+ SET UP A
   BAND**: name, start, end, and which weekdays, creating one block per day.
2. **The rendering was not the frame.** Frames 8a and 9a draw each band as a
   solid black block in the gutter — 21px condensed name in white, mono range in
   yellow — with the band's hours in every day column as **white between two 2px
   black rules**. What shipped was a small black text caption and a bone tint.
   A tint reads as "something is booked here", which is the one thing a band is
   not. Both are now per frame, and the gutter widened to the frame's 92px
   (64px below `md`) so a 21px condensed name fits.

`prayer-room/preview-8a` renders the wall against fixture bands, same dev-only
idiom as `bookings/preview-3c` — without it the band treatment cannot be checked
at all, because every real week has zero bands until someone creates them.

**Still to do, and it needs a human:** the three bands do not exist in
production. Their real times are FFSA's call, not the design file's
(08:00–09:30 / 12:00–14:00 / 17:00–19:00 are the frame's illustration). Staff
create them from the Evaluators tab.

#### Integrating the three gaps — what each actually needs

**1. Attendance ("I'm coming", and 11a's TURNED UP).** These are two different
things and only one of them is cheap.

*"I'm coming"* is a walk-in RSVP by someone who holds no seat. One table, one
migration (**176**), one route, one button:

    prayer_room_attendance(id, set_id, user_id, created_at, UNIQUE(set_id, user_id))

RLS: read to authenticated (the wall already is), insert/delete your own row
only. `POST/DELETE /api/prayer-room/attendance`, and the drawer footer's
primary becomes I'M COMING with ADD TO CALENDAR demoted to the outline slot.
Half a day, no product decision needed.

*TURNED UP 21/22* is not the same table and is not a build problem — it is a
**workflow decision nobody has taken**: somebody has to mark who actually
showed. The natural hook is the lead marking the set complete
(`completeSet` already exists), which would become a roll-call of the filled
seats rather than a one-click status change. That adds `attended boolean` per
slot and a step to a flow people currently finish in one tap. Do not build it
until someone decides the lead is willing to do that every set; until then the
KPI stays SEATS SIGNED OFF, which is real and free.

**2. Hand over.** Nearly there, and the blocker is a policy, not a route.
`PUT /api/prayer-room/sets` **already whitelists `owner_id`** (route line ~267),
so the write path exists. What stops it is the RLS from migration 171:

    CREATE POLICY "Update sets" ... WITH CHECK (
      public.is_prayer_room_staff()
      OR (owner_id = auth.uid() AND NOT public.prayer_set_is_curated(id))
    )

`WITH CHECK` tests the NEW row, so an owner handing the set to someone else is
refused — the new `owner_id` is no longer them. Staff can already do it today.
To let a lead hand over, migration 176 must split the policy so the USING clause
(who may edit) stays as it is while the WITH CHECK allows `owner_id` to change
when the OLD owner is the caller. Then it is UI: reuse `member-picker.tsx` in
the drawer's HAND OVER slot, and send the new owner an email — the sender
already exists (`lib/email/send-prayer-room.ts`, five templates), this needs a
sixth. Roughly a day including the policy test.

**3. 11b.** See above — it is the mobile shell for the module, not a screen, and
9b gates its primary action. Sequence: 9b claim flow (the two extra drawer
states: a curated band cannot be claimed, empty white space can) → the mobile
day run → the bottom bar, whose ALERTS item should hang off the existing
dashboard notification feed (migration 096) rather than inventing a second one.
That is its own session, and it is the largest of the three.

#### Still on the old design inside this module

Frames 9a/10a/10b/11a/12a/12b are clean. These files were not in scope and are
untouched pre-redesign structures: `calendar.tsx` (the month and list views —
also the module's only real `shadow-[…]`), `admin-panel.tsx` (Manage tab),
`my-sets.tsx`, `my-seats.tsx`, `apply-form.tsx` (still uses `page-eyebrow`),
`evaluations.tsx` (the join-the-room pipeline), `member-picker.tsx`, and the
`CreateSetDialog` inside `schedule-view.tsx`.

#### Acceptance sweep — say what was scanned

Scanned: **48 files** = `src/app/(admin)/prayer-room/**` (22),
`src/components/ffsa/**` (1), `src/app/api/prayer-room/**` (17),
`src/services/prayer-room*.ts` (4). In the six frames' own files: 0 `rounded-*`,
0 `shadow-*`, 0 `page-title`, 0 dark-theme hex. Across all 48: 21 `rounded-*`
and 2 `shadow-[…]` remain, all in the out-of-scope files listed above; 1
`page-eyebrow` in `apply-form.tsx`. `tsc --noEmit` and `next lint` clean.

Verified signed in at 1440px and 375px against production data, which is thin —
no qualifications rows exist yet, so every roster row reads NOT EVALUATED and
the sign-off records are empty. The structure renders; the numbers are real and
mostly zero.

### `08-training-and-messages.md` — §1–4 built (branch), §5–6 not
14a, 14b, 14c and 15a are on `redesign/training-depth` — see the section above.
What remains is the half the handoff warned about: Messages is the thing every
later feature sends through, and billing's email moments (07 §10) depend on it.

- 15b/15c Messages — **needs tables `school_message_moments` + `message_sends`**;
  `source` column drives FFSA DEFAULT / THIS SCHOOL and makes revert possible
- 16a student mail, 16b/17b compose drawer, 17a/17b bulk (N separate emails)

### `07-finance-billing.md` — 9a and 9b only
Remaining: 9c (dry run → create → send as three steps; Xero webhooks; three-tier
matching; reconciliation inbox), 9d (prepay, the four transitions, approval
matrix, adjustments, refunds), 9e (student fees tab 27a, portal fee view 24a),
§10 email moments, debtors (26a), copy-to-next-intake (21d).

### Recipe items never started
- **Public event page (4c)** — "the loudest surface… the only place the brand
  runs at full volume". Full-bleed photo masthead, 118px title, facts strip.
- **Mobile portal (4d / 11b)** — bottom tab bar, 4 items, 48px targets.
- Module panel extras: saved views as stacked chips (Events), audience segments
  with counts (Communications).
- Dashboard bottom strip: support raised with a Bar, plus a photo tile.

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
- **Bookings**: spaces and vehicles are NOT one timeline. 3c drew them together;
  that was built and then reversed by product decision on 2026-08-18. A space is
  a timetable, a vehicle is a rental process. Do not "fix" this back.
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

**Next new migration: 180.** 176/177/178 are pre-assigned to sessions 2/5/6 by
`93-session-prompts.md`; **179** (grades → billing_courses) is APPLIED. Always
branch off `origin/main` and check `ls supabase/migrations | sort | tail` first.

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

---
---

# Audit — 2026-08-19 · `handoff/` catch-up plan vs `main`

Run against `origin/main` at `fa2a18f`, migrations `001`–`180`.

## Why this section exists

An untracked `handoff/` folder in the `CODING/ffsa-platform` checkout carries a
parallel copy of docs 01–13 plus `14-build-status.md` and `15-catch-up-plan.md`.
Its headline claim — *"the visual layer never landed; `globals.css` still holds
the dark theme"* — **is false against `main`.** It says so itself in passing:
*"migrations present: `001`–`106` (nothing above 106)"*. It audited a snapshot
from before PR #212 merged on 2026-08-17.

**Do not run its Session 1.** `handoff/01-globals.css` is 486 lines; `main`'s
`src/app/globals.css` is 550 and is that file *plus* later fixes — the mobile
masthead `clamp(34px, 7.5vw, 58px)`, the search-icon `pl-*` padding restoration,
the `h-9` select-clipping fix, `.ff-email-content` opting rich text out of
uppercase/tracking, and the `.ffsa-screen` transition scaffold.
`handoff/04-ffsa-primitives.tsx` is 137 lines against `main`'s 354 / 17 exports.
Replacing either "wholesale" is a revert, not a catch-up.

Its `15-catch-up-plan.md` sessions are re-audited below. Where a thing exists on
`main` under a different name, the name on `main` wins — the gap is the missing
*column or behaviour*, not the missing table name.

---

## Sessions 1–3 · the design system and its rollout

### Session 1 — **DONE.** Nothing to do.

| Target | State on `main` |
|---|---|
| `globals.css` editorial light, `--radius: 0` | Present, superset of the handoff |
| Roboto Condensed / Roboto / Roboto Mono in `layout.tsx` | Present |
| `tailwind.config.ts` — every radius `0`, every shadow `none`, `letterSpacing.label/chip`, surface ramp, brand colours | Present |
| `src/components/ffsa/index.tsx` | Present — 354 lines, 17 exports (handoff has 8) |

`Bebas_Neue` is still imported in `layout.tsx`, deliberately: only
`(public)/e/[slug]/the-send-storefront.tsx` reads `var(--font-bebas)`, and
storefront brand kits are out of scope. **Not a gap.**

There is also no false "steps 2–7 are done" line in `CLAUDE.md` on `main` to
correct — that sentence exists only in the snapshot `handoff/14` was quoting.

### Session 2 — **DONE**, except the screen it names.

`src/components/admin-sidebar.tsx` is the 74px black rail + 212px bone panel
(`w-[74px] bg-ink`, `w-[212px] border-r border-ink bg-bone`). The shell landed.
But session 2 says *convert Contacts first* — **Contacts was never converted**,
so the pattern was proven on other modules instead. See below.

### Session 3 — **PARTIAL.** 27 admin pages, the whole portal, and most public routes remain.

`.ffsa-screen` is the reliable marker for an admin route recomposed onto the
primitives (it opts a page into the full-bleed workspace). Per admin module:

| Module | pages | recomposed |
|---|---|---|
| bookings | 17 | **all 17** |
| finance | 9 | **all** |
| events | 8 | 7 of 8 |
| communications | 6 | **all 6** |
| schools | 2 | **all** |
| prayer-room | 2 | **all** |
| dashboard | 1 | **yes** |
| **contacts** | **9** | **0** |
| **records-library** | **6** | **0** |
| **users** | **3** | **0** |
| **ministry** | **2** | **0** |
| brand-kit · consents · mission · org-chart · roles · settings · teams | 1 each | **0** |

**27 admin pages unrecomposed.** Contacts (9) and users (3) are the highest
traffic, exactly as session 2 predicted when it chose Contacts as the proving
ground.

Outside `(admin)`:

- **`(auth)` — done.** `src/app/(auth)/auth-shell.tsx` carries login, join,
  forgot/reset password and onboarding (frame 4b). `.ffsa-screen` is an admin-layout
  opt-in and its absence here is expected, not a gap.
- **`(portal)` — not started.** All 7 areas (`my-finance`, `my-schools`,
  `my-events`, `my-attendance`, `my-history`, `my-mission`, `profile`) still lead
  with `<h1 className="page-title">` and import nothing from `src/components/ffsa`.
  Frame 4d is unbuilt.
- **`(public)` — mixed and mostly deliberate.** Storefronts and brand kits are
  explicitly out of scope; `apply`, `reference`, `schedule`, `preferences`,
  `unsubscribe` are not, and are unconverted.

### Acceptance sweep — scanned `src/app` + `src/components`, excluding `src/components/ui`

| Pattern | hits | files |
|---|---|---|
| `rounded-(sm\|md\|lg\|xl\|2xl\|3xl\|full)` | 275 | 99 |
| `bg-card` | 70 | 33 |
| `page-title` | 41 | 35 |
| inline `borderRadius: <non-zero>` | 83 | 34 |
| dark hex `0D0B09` | 30 | 15 |
| `shadow-(sm\|md\|lg\|xl\|2xl)` | 22 | 14 |
| `Bebas` | 2 | 1 (the-send-storefront, in scope by design) |

**Read these two groups differently.** `tailwind.config.ts` resolves every radius
token to `0` and every shadow to `none`, and `--card` is white — so the utility
classes are *hygiene debt that renders correctly today*. The ones that actually
leak to screen are the **inline styles**: `borderRadius: "16px"` and friends beat
the config because they are element styles, not utilities. Worst offenders:
`users/[id]/permission-manager.tsx` (11), `apply/status/[token]/reference-editor.tsx`
(7), `users/[id]/role-assignment.tsx` (7), `account/security/page.tsx` (5),
`contacts/event-followup/followup-queue.tsx` (5). One is inside a *finished*
module: `dashboard/dashboard-customize-panel.tsx` sets `borderRadius: "16px"` on
its own frame.

`page-title` (41 hits / 35 files) is the truest "this screen was never
recomposed" marker — better than the radius count.

---

## Sessions 4–9 · module by module

### Session 4 · Widget dashboard — **mostly built, under a different architecture**

`handoff/15` says *"nothing of this exists in code"*. Wrong.

**Exists:** `src/lib/dashboard/widget-registry.ts` — a **16-widget** catalogue with
`key`, `title`, `description`, `category`, `defaultOrder`, `fullWidth`, plus
role-aware `gate(ctx)` and `defaultEnabled(ctx)` predicates over a precomputed
`DashboardContext`. Migration `135_dashboard_layouts` stores one ordered
`[{key, enabled}]` JSONB per user. `dashboard-customize-panel.tsx` does drag
reorder (dnd-kit `arrayMove`) and show/hide toggles. All 16 widget components are
wired.

**The session-4 rule is already enforced, and documented in the migration itself:**
*"a stored layout is a preference, never an authorisation"* — every widget's API
route re-checks permission server-side, so enabling a widget you lack access to
yields an empty widget, not data.

**Genuinely missing:**
1. **S/M/L sizing.** Only a `fullWidth` boolean exists.
2. **Per-instance `config` jsonb.** A widget cannot be parameterised, so the same
   widget cannot appear twice configured differently.
3. **Pinning and dismissal.** No `pinned_by` / `dismissed_at`; a leader cannot push
   a widget to someone, and there is no dismissal signal back.
4. **Role-default layouts as rows.** Defaults are code predicates, not
   `dashboard_layouts` rows per role. This is arguably better — but 33b's right
   column cannot be edited without a deploy.
5. **Role-locked entries "greyed and labelled, never hidden."** `gate()` *removes*
   ungated widgets from the panel. The spec wants them visible and explained.
6. The catalogue is in code, not a `dashboard_widgets` table. **Treat as a decision,
   not a gap** — it keeps the registry and the render map in one file.

### Session 5 · Vehicles — **the nine deltas mostly stand**

**Exists:** migrations `103`–`107`, `112`. `vehicles`, `vehicle_bookings`,
`vehicle_booking_assignments`, `vehicle_booking_drivers`, `vehicle_inspections`
(+ files), `vehicle_payments` (PayFast, ZAR cents), `vehicle_agreements`
(e-signature), `vehicle_request_link_settings` + `bookings.source` +
`submitted_ip` for a public request link, and `107` adding `home_country`,
`fx_rate`, `usd_amount` and the `VehicleRent` Xero code.

**The shape is confirmed wrong-direction**, as `handoff/12` says. On
`vehicle_bookings`: `currency text NOT NULL DEFAULT 'USD'`, `pricing_per_day`,
`status CHECK (pending|approved|denied|cancelled|completed)`, and a named-vehicle
assignment table. Migration `112` added a public **request** form — an intake for
the same approval queue, not a shop.

**Genuinely missing — all nine deltas, unchanged:**
`vehicle_class` + `quantity` on the booking · assignments becoming optional ·
rate on the class with `ZAR` default · `'held'` status + `hold_expires_at` + a
**cron** sweep (never a browser timer) · the availability endpoint with two
projections of one query, gated in the route · a paid public booking path with
`public_token` · `vehicle_coupons` + redemptions · `service_last_km` /
`service_interval_km` / `licence_expires_on` · `vehicle_settings` buffer day and
`vehicle_payments.kind`.

Two rules to carry into that work: licence expiry is **inclusive**, and
availability is the **minimum across the whole window**.

Note for whoever picks this up: PR #234 already split bookings so vehicles are a
**rental portal with no grid**, which is the right direction for this session.

### Session 6 · Consent and the message log — **the ledger is missing; the log is 90% there under another name**

**Exists:** `141_email_messages` is the `messages` table in all but name — one row
per email across every provider and module, with `to_email`, `contact_id`,
`provider`, `provider_message_id`, `category`, `subject`, `event_id`, `order_id`,
a generic `(source_type, source_id)` pair, an 8-state `status`, `bounce_type`, and
per-transition timestamps. A Resend delivery webhook advances it. The per-contact
"Email history" card ships (PR #130). Campaigns, campaign labels, sending
identities, preferences and unsubscribe all exist and are good.

**Genuinely missing:**
1. **`consent_events`** — append-only, one row per event, with source and lawful
   basis. `034_consent_agreements` / `164_consent_kinds_and_policies` are **policy
   acceptance**, not marketing consent. Do not repurpose them.
2. **`contacts.marketing_status` is still the source of truth** (`041`, a 4-value
   CHECK with a plain index). The spec wants it inverted into a read-only cache of
   the ledger.
3. **The plain-words `reason` column.** `email_messages.category` is a slug
   (`'ticket_confirmation'`), not "She is in DTS 26-2 students". That column is the
   entire point of the per-person log at 29d — it is a small migration and it is
   the highest-value single item in this session.
4. **A send path that refuses on no lawful basis**, with transactional and urgent
   event mail as the only bypass, urgent being typed-to-confirm and counted.
5. The one-time ask to contacts with no consent record (31c).

Sequences and the reply inbox stay deferred to session 9.

### Session 7 · Finance — **further along than the plan assumes**

`handoff/15` says `scheduled_charges` does not exist. It does — as
**`student_billing_schedule`** (`095`).

**Exists, and matches the spec closely:**
- `fee_charge_items` carries **all four due anchors** (`acceptance`, `month_day`,
  `fixed_date`, `relative_to_arrival`) and **all four generation rules**
  (`immediate`, `preceding_month_15th`, `fixed_date`, `days_before_due`), with
  cadence and quantity. No hardcoded dates.
- `student_billing_schedule` holds `scheduled_generation_date` separately from
  `due_date`, with a `scheduled → generated → sent → paid` status and Xero linkage
  including `combined_group_key`.
- **`172_program_billing_mode`** — `billing_mode` with every existing program set
  to `external`, new ones `hub_scheduled`. Session 9a of the old plan, done.
- **`173_billing_needs_decision`** — the `needs_decision` hold with the three named
  outcomes, and its comment records that the API had been silently writing every
  row as `scheduled`, which would have backdated a late acceptance. Session 9b's
  queue half, done.
- `098`/`100`/`179` billing courses, `101` program pricing.

**Genuinely missing:**
1. **The approval-limits matrix.** No `approval_limit*` table anywhere — so
   "one table read by every screen that gives money away, nobody approves their
   own" is unenforced.
2. **The reconciliation inbox.** No reconciliation table; nothing implements
   match-on-invoice-number-or-name-plus-exact-amount, and there is no "held money
   stays visible" surface.
3. **"Issued can only be credited" is not enforced in the schema** — there is no
   constraint or trigger stopping a `generated` row being rebuilt. The rule exists
   in the docs and (partly) in the API. It should be a database guarantee.
4. **The four editable email moments per charge** (invoice / reminder / overdue /
   receipt), each carrying amount, reference and full bank details in the body.
5. Frames 27a (student fees tab) and 24a (portal fee view).

### Session 8 · Outreach budgets — **a built module with the wrong line model**

`handoff/15` says *"only `outreach_budget_categories` (`008`) exists — effectively
a new module"*. Wrong. Migration `008` creates **nine** tables:
`outreach_teams`, `outreach_team_members`, `outreach_budget_categories`,
`outreach_team_budgets`, `outreach_fund_releases`, `outreach_cash_batches`,
`outreach_expenses`, `outreach_receipts`, `outreach_closeouts`. There are live
routes at `(admin)/finance/outreach` and `(portal)/my-finance/outreach`, and a
`src/services/outreach-finance.ts`.

**Genuinely missing — the model deltas, not the module:**
1. **`amount × frequency × people`.** `outreach_team_budgets` is
   `(team_id, category_id, people_count, budget_amount_zar)` — a flat amount per
   category. No `frequency`, and no per-line "follows team size" vs "fixed" flag.
2. **Owner kinds as a table.** Ownership is hardcoded to `team_id`. A school,
   ministry, region or partner church cannot own a budget without a migration —
   which is precisely what the polymorphic-owner requirement exists to prevent.
3. **Sections** within a budget.
4. **The importer** in full — header-row detection, the blank-heading description
   column, rand-with-commas parsing, a described zero kept, skipped rows greyed
   **with a reason** by spreadsheet row number, and a total mismatch never silently
   overwritten. Nothing of this exists.
5. **The receipt with a nullable budget line** — a field photo with no line saving
   as "needs a line", with uploading and checking as separate steps.
6. The 24-hour undo on an import receipt.

### Session 9 · Contacts deltas — **4 of 6 exist under other names**

Contacts is the most complete module in the codebase: `068`/`076` contact
identifiers (`contact_emails` / `contact_phones`), `087` permission access,
`findDedupMatches` in `src/services/contact-upsert.ts`, and routes for
`duplicates`, `import`, `imports`, `lists`, `event-followup`.

| `handoff/13` delta | State |
|---|---|
| `contact_imports` | **Exists as `csv_imports`** (`047`) — filename, row_count, label, imported/matched/review/error counts, `error_log` jsonb |
| `contact_merge_decisions` | **Exists as `dedup_review_queue`** (`047`) — verify it records the *decision*, not just the pending pair |
| `activity_events` | Exists (`043`), with a `csv_imported` kind |
| **`labels.kind` (arrival vs manual)** | **Missing.** `labels` has `category`, `color`, `is_preset`, `is_active`, `sending_identity_id` — no `kind` |
| **Retire `person_types` into labels** | **Not done.** `person_types` is still live from `001`, and `137_signup_links` still writes to it |
| **`contact_relationships` (symmetrical)** | **Missing entirely.** Closest is `153_household_members` / `160_household_member_contact`, which is a different model |
| `marketing_status` derived from the ledger | Blocked on `consent_events` — see session 6 |

---

## Revised order

Sessions 1 and 2's shell are done, and sessions 4, 7 and 8 are far enough along
that running them as written would rebuild working code. What is actually left,
cheapest-first:

1. **Contacts + users recomposition** (12 pages) — session 2's own choice of
   proving ground, still unconverted, and the highest-traffic admin routes.
2. **`email_messages.reason`** — one column, and the thing that makes the
   per-person log worth having.
3. **`consent_events`** + inverting `marketing_status` into a cache, then the send
   path that refuses without a lawful basis.
4. **The finance guarantees** — the approval-limits matrix, a schema-level
   "issued can only be credited", then the reconciliation inbox.
5. **Portal (frame 4d)** — 7 areas, all still on `page-title`.
6. **Outreach line model** — frequency, owner kinds, then the importer.
7. **Vehicles** — the nine deltas, on top of PR #234's portal split.
8. **Dashboard extras** — sizing, per-instance config, pinning/dismissal.
9. **Remaining 15 admin pages**, then the in-scope public routes.

Hygiene to fold into whichever screen you are already touching: the 34 files with
inline non-zero `borderRadius` (these render), then `page-title`, then the
utility-class residue (which does not render).
