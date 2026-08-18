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
| Bookings (3c) — **the timeline itself, rebuilt** | ✅ see the 3c section below |
| Event capacity, campaign open/click, finance ledger, bookings day strip | ✅ built (migrations 174, 165) |
| Prayer room data model + wall (8a) | ⚠️ migrations 175, 168, 169, 170 applied — **171 is NOT** (see below) |
| Prayer room UI — masthead, 9a, 10a, 10b, 11a, 12a, 12b | ✅ merged 2026-08-18 (PR #226, `87cae22`) — no migration |
| Billing: `billing_mode` (172), generation guard + held-charge queue (173) | ✅ with tests |
| Xero: read side, honest status, per-region org pinning | ✅ |

---

## 3c — bookings timeline, rebuilt (session of 2026-08-18)

The calendar was the "restyled, not rebuilt" case this file called out. `/bookings`
was a hub of two description cards with the day timeline as a read-only strip
underneath. **The timeline is the screen now.**

Paths scanned by every acceptance grep below: `src/app/(admin)/bookings` — 46
files, the whole module. Numbers quoted from any narrower sweep are worthless.

| Frame element | State |
|---|---|
| 230px resource column against a black hour header | ✅ |
| Hour columns as gridlines; blocks positioned by percentage | ✅ |
| Spaces AND vehicles on ONE timeline | ✅ |
| Masthead: eyebrow (date · N resources · N waiting), day nav, book action | ✅ |
| SHOWING — all / spaces only / vehicles only | ⚠️ built, but in the control strip, not the module panel (see below) |
| "Requests waiting on approval" underneath, with APPROVE | ✅ |

Files: `page.tsx` (data + gating only), `bookings-day.tsx` (the frame),
`day-timeline.tsx` (the grid), `approval-queue.tsx` (the strip).
`blockWindow` / `packLanes` / `computeHourRange` are reused from
`src/lib/bookings/timegrid.ts` — no second geometry vocabulary was invented.

### The separation that matters

Spaces and vehicles are **separate services with separate permission modules**,
and the rebuild keeps them that way:

- `page.tsx` asks `hasModuleAccess` for `bookings` and for `vehicles`
  independently, then fetches each half only if its own answer was yes.
- Each half's fetch is wrapped so one failing cannot take the other's screen
  down.
- The frame has **no group headings** — each lane carries its own `SPACE` /
  `VEHICLE` line. That is per the frame, and it is also structurally why a
  vehicles-only viewer cannot be shown an empty "Spaces" heading: there is no
  heading to leave behind.
- Approvals are gated a second time, per half, on that half's `canApprove`,
  and APPROVE posts to that half's existing decision route, which re-checks the
  permission server-side.
- Vehicle bookings are date-only in the schema, so every one is an all-day
  block — which is exactly what makes a van already out read as a clash against
  anything else booked on it that day.

### Deviations from the frame, stated plainly

1. **SHOWING sits in the control strip, not the module panel.** The frame puts
   it in the 212px panel. Per-module panel content is its own backlog line
   ("Module panel extras") and needs a shell mechanism that does not exist yet.
2. **Two book buttons, not one `+ BOOK`.** The two services have separate
   create routes; a viewer with one module still sees a single button.
3. **The two service links** (Spaces ↗ / Vehicles ↗) are in the control strip
   because the global nav carries a single Bookings entry, and those routes
   still hold the month/week/list views, the fleet and the full review queues.
   Removing the hub cards without them would have stranded both sub-modules.
4. **Deny is not on the strip.** The frame shows only APPROVE. Deny, notes and
   clash detail stay in each service's own review queue.

### Not done in this session

- The spaces module's own **month / week / list** views
  (`booking-calendar.tsx`, `week-view.tsx`, `day-view.tsx`, `time-grid.tsx`)
  are untouched. They are still restyled-not-rebuilt. 3c only specifies the day
  timeline; those views have no frame of their own yet.
- The vehicles module's `vehicles-view.tsx` list is likewise untouched.

### Verification

Signed in, against the real database, on `redesign/bookings-timeline`:

- **1440×1000** and **375×812**, `/bookings?date=2026-08-31` — a date carrying
  both a timed space booking (Office 2, 09:35–21:55, which stretches the hour
  range to 21) and an all-day vehicle booking assigned to three vehicles. Page
  never scrolls horizontally at 375; the grid scrolls inside its own container.
- `/bookings?date=2026-08-31&show=vehicles` — 6 lanes, no space rows, no
  heading, no error. Same code path a vehicles-only viewer takes.
- Clash rendering has **no real data to exercise it** — nothing in the database
  overlaps. `/bookings/preview-3c` renders the same `<BookingsDay>` against
  fixtures with two deliberate clashes (one timed, one all-day). It 404s in
  production. Keep it: it is the only way to see the clash state, and it caught
  two defects real data hid — a "now" line drawn on every date rather than
  today, and narrow blocks dropping the booking title in favour of its clock.

Acceptance sweep over all 46 files in `src/app/(admin)/bookings`: 0 `rounded-*`,
0 `shadow-*`, 0 `page-title`, exactly one `<Masthead>` per screen across 17
files. The only hex literals left in the module are the frame's own black-header
tones (`#C5C2AE`, `#2A2A26`, `#262622`, `#55524A`, `#8C8A80`) and venue /
vehicle **colour data** (`#0ea5e9`, `#6366f1`, `#64748b` as picker defaults and
the fallback) — data colours stay, per the decision already recorded below.

---

## Built, on a branch, not yet merged

**`redesign/training-depth`** — session 3, `08-training-and-messages.md` §1–4.
Scope scanned: `src/app/(admin)/schools` (all 12 files) plus `src/services/schools.ts`
and `src/app/(portal)/my-schools/[enrollmentId]/page.tsx`, both of which had to
follow the course-model change below.

| Frame | State |
|---|---|
| 14a school detail | ✅ masthead + facts line, 300px phase run (only the current phase bordered + 900), six-column roster, amber fees, `—` in #B4B0A2, NeedsYou counts exactly those dashes |
| 14b grades matrix | ✅ built; migration 179 applied, saving verified end to end |
| 14c applicant review | ✅ full screen, answers at 15px/1.5, decision bar pinned outside the scroll |
| 15a form builder | ✅ one list, conditionals indented 26px on #F7F5EE with the yellow SHOWS WHEN pill, live public preview |

Verified signed-in against real data (FFBX26, 41 students; TRACK, real conditional
follow-ups) at 1440px and 375px. No page-level horizontal overflow at 375px on any
of the four; the grades matrix scrolls inside its own box. **No screenshot files
were committed** — this folder has no screenshot convention yet and inventing one
mid-session seemed worse than saying so. Verification was live in the browser.

### Migration 179 — APPLIED 2026-08-18

`supabase/migrations/179_grades_on_billing_courses.sql`, run through the Supabase
dashboard SQL editor (never `supabase db push` — CLI history is out of sync).
Verified after the fact: the `credit_hours` column exists and a grade keyed to a
`billing_courses` id inserts, which the old FK would have rejected.

**Every course is `credit_hours = 0`.** There was nothing to backfill from, so the
matrix header reads "0 CREDIT HOURS" and the transcript GPA weights everything at
zero until real values are entered. There is no admin field for it yet — that is
the first follow-up, and it belongs on the Courses tab beside code and name.

**Why 179 and not 176:** the parallel-rules table pre-assigns 176/177/178 to
sessions 2/5/6. Session 3 was listed as "none expected — ask before taking one",
and this one was asked for and approved.

### The course model, settled

Two course tables have coexisted since 098: `courses` (academic, the FK target of
`grades`) and `billing_courses` (chronological, what the live Courses tab writes
through). Only the second was ever maintained — **`courses` holds 1 row across 3
programs and `grades` is empty**, so 179 re-points `grades.course_id` at
`billing_courses` and adds `credit_hours` to it. Zero rows to migrate; the
migration refuses to run if that ever stops being true.

`courses` is left in place, unused, rather than dropped — that is a separate call.
Every read now aliases it (`courses:billing_courses(*)`) so callers were unchanged.
The page tolerates the pre-179 schema by retrying the course read without
`credit_hours`, so a deploy landing before the hand-applied migration degrades
instead of blanking the tab.

### Two shared-file changes wanted, reported not made

Per the parallel rules, neither was applied here:

1. **`Masthead` needs a `meta` slot.** 14a wants a mono line under the title
   (dates · weeks · location). It is rendered as a separate strip below the
   masthead instead, which works but is a second element where the design has one.
2. **`globals.css` forces `button { font-family: mono !important; text-transform:
   uppercase }`.** Any button whose label is prose — a form-builder question, a
   roster row action — has to opt back out with `!font-sans normal-case`. The
   frame sets `text-transform:none` on that row for the same reason. Worth
   scoping the global rule to `[data-slot="button"]` instead.

Also wanted, smaller: a **filled** variant of `StatusPill`. 14a's roster status is
explicitly "a filled pill, not an outline"; that is currently local to the roster.

### Also done on this branch

- Deleted three dead components from `program-detail.tsx` (~900 lines): the old
  `CoursesTab` (orphaned when Courses moved to `ProgramCoursesManager`),
  `EnrollmentsTab` (replaced by 14a) and the unlinked `GradesTab`. The file is
  ~3.6k lines, down from ~4.5k, with the four screens now in their own files.
- The Grades tab is **linked** for the first time — it had a `TabsContent` with no
  trigger, so it was unreachable.
- Fixed a pre-existing SSR crash: `ApplicationTab` read `window.location.origin`
  during render, so `?tab=application` threw "window is not defined" and dropped
  the route to client rendering.
- Enrolment removal/restore/permanent-delete and "+ Add student" survived the
  rebuild — the frame's roster is six columns and stays six columns, so removal
  moved to a row menu and the add button to the masthead, where 14a puts it.

**Still outstanding in `08-training-and-messages.md`:** §5 Messages (15b/15c) —
superseded by doc 11, belongs to session 2 — and §6, frames 16a/16b/17a/17b.

---

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
