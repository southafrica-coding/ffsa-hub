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

## Prayer room PRACTICE — handoff 17, frames 36a–36e (branch `redesign/prayer-practice`, 2026-10-01)

**Migration 224 — APPLIED 2026-10-01.** 225 (view security, below) pending. Before 224 the practice API errored and the wall
simply draws no lane (the PRACTICE tab shows "Loading practice…").

| Piece | Where |
|---|---|
| Tables | `practice_settings` (singleton), `practice_stations` (7, `seat_type_id` → `prayer_room_seat_types`), `practice_bookings`, `practice_booking_people`, `practice_moves` |
| Clash rules | three EXCLUDE constraints on `practice_bookings.slot`: station/station, band/band, band/station (`kind WITH <>`) |
| Window / 30-min step / 60 max / Sunday opening / not in the past | trigger `practice_validate_booking` |
| Vocals ≤ 4, nobody in two places at once | trigger `practice_validate_person` |
| Writes | RPCs `practice_book_station`, `practice_book_band`, `practice_cancel`, `practice_move_plan`, `practice_move_and_book_band` (staff + reason, checked again in the route) |
| Routes | `/api/prayer-room/practice` (GET week), `…/practice/bookings` (POST), `…/bookings/[id]` (DELETE), `…/practice/move` (GET plan, POST move) |
| UI | PRACTICE tab (`practice-view.tsx`: 36a desktop, 36e phone), drawers (`practice-drawers.tsx`: 36b/36c/36d), compact lane on the main wall (`wall.tsx`) |
| Telling people | dashboard feed provider `practiceNotifs` — band members and moved people. **In-app only**; no email or Slack DM yet |
| NIGHT | moved to 17:30–20:00 by 224 (template rows + any generated future sets), fixtures and CLAUDE.md updated |

Practice is **not coverage**: nothing writes `prayer_room_sets`, so no count of sets,
seats or minutes can include it. Not built: 36e's bottom bar (WEEK · PRACTICE · MINE ·
PEOPLE) — the module tab strip already carries PRACTICE on phones.

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
(08:00–09:30 / 12:00–14:00 / 17:00–19:00 were the frame's illustration; NIGHT
was moved to 17:30–20:00 by migration 224 to make room for practice). Staff
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

**Next new migration: 226** (224 = prayer practice, 225 = prayer view security). Older note: **Next new migration: 180.** 176/177/178 are pre-assigned to sessions 2/5/6 by
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

## Session A — contacts directory + users · MERGED 2026-08-19 (PR #258, `92f67e8`)

No migration. Frame **35a built**: search-first (searches `contact_emails` /
`contact_phones` rather than the denormalised primaries, and reports what it
matched on), 250px bone label aside with live counts, five-column real table,
and the button that hands the current filter to Communications.

Also cleared out of `(admin)/contacts` and `(admin)/users`: **36** non-zero
inline `borderRadius`, **16** `#0D0B09`, **152** `hsl()` references to the old
dark palette. Those inline styles are what actually rendered — the utility
classes were already square via the config. 23 of the yellows were *text* on a
white surface, i.e. illegible on `main` until this landed.

Bug fixed in passing: the contacts label filter never filtered — `.eq()` on an
outer embed returns every contact with non-matching labels merely emptied out.

**Deferred to session G** (schema): `labels.kind`, so the sidebar has one label
group rather than the frame's arrival/manual split; `person_types`;
`marketing_status` as a cache of a `consent_events` ledger.

**Still open on this screen:**
- **Never visually verified.** No screenshot at 1440 or 375, and no Vercel
  preview (the deployment failed on a Git-author permission, not a build error).
  The frame check in the definition of done above has NOT been run on 35a.
- Five demographic columns (DOB, marital, city, country, nationality) left the
  list to match the frame's five. Still on the record and in the quick-view.
- `contacts-list.tsx` (536 lines) is orphaned but not deleted.

### Correction to the 2026-08-19 audit above

That audit read `origin/main` only, so its "revised order" describes **merged
state, not outstanding work**. PR #224 already carried the portal, the public
routes and 27 admin routes; it was closed at Jack's direction on 2026-08-19 and
its branch deleted (recovery SHA `87b925f`, restore command in a comment on
#224). Before treating any remaining item as unstarted, check the open branches
— this repo runs a dozen worktrees at once.

## SUPERSEDED — read the section below instead

## (stale) Verified against main, 2026-08-25 (commit b3c3b22)

Re-checked in code rather than carried over from earlier claims. Migrations
still end at 175, so **next migration is 176**. `npx vitest run` → 7/7 pass.

| Session | State in code | What remains |
|---|---|---|
| 1 Prayer room UI | Data layer complete (168-171, 175 applied). All 19 components wired; the wall (8a) IS mounted, via `components/schedule-view.tsx`. **Zero `Masthead` and zero `NeedsYou` across the whole module**, and `prayer-room/page.tsx` still has no `.ffsa-screen`. | 9a/10a/10b/11a/12a/12b + module chrome. Also: the OLD `calendar.tsx` (`ScheduleCalendar`) still renders alongside the wall inside schedule-view — decide whether it survives. Band curation is bolted inside `evaluations.tsx` and `my-seats` inside `my-sets.tsx` rather than being their own tabs. |
| 2 Communications | No generic `messages` table exists. `email_messages` (141) live with Resend webhooks; campaigns, `v_campaign_stats` (174), identities, labels, suppressions all live. No reconciliation doc written. | Everything. Write `94-communications-reconciliation.md` FIRST. |
| 3 Training depth | Shell already recomposed — `.ffsa-screen` + `Masthead` on schools/page.tsx, [programId]/page.tsx and program-detail.tsx. `program-detail.tsx` is 4,467 lines. No form-builder conditionals anywhere. | 14a roster depth, 14b grade matrix, 14c applicant review, 15a builder. NOT the chrome. |
| 4 Bookings 3c | **Further along than previously recorded.** `day-timeline.tsx` (242 lines) already implements 3c: both services on one timeline, 230px resource column, lane packing, per-row clash ids, each half permission-gated independently. | Only the promotion — it is mounted read-only as a "Today" strip on the hub. Make it the main experience with date navigation. Do not rebuild the geometry. |
| 5 Billing | 9a + 9b done and tested (7/7). `generate-invoices` already accepts `dryRun`. `needs-decision` route live. `billing_emails_enabled` exists and is surfaced in the UI. | No Xero **webhook** route exists (only callback/connect/disconnect/invoices/organisations/status). No `awaiting_approval` status, no three-tier matching, no reconciliation inbox. |
| 6 Outreach | Tables predate the redesign (008, 016, 017). `budget-import.tsx` (471 lines), `expense-import.tsx` and the import API all exist. | **The flagged risk is real and unguarded**: zero occurrences of duplicate / idempotency / batch-id / undo anywhere in the import path. Reconcile doc 10 against the existing tables before adding any. |
| 7 Public + old routes | 28 admin routes still lack `.ffsa-screen`. Generic `e/[slug]/storefront.tsx` is still old shadcn `Card` composition — zero editorial markers. No mobile bottom tab bar anywhere. | 4c, 4d, the 28 routes, then delete the scaffold (globals.css ~line 484 + layout.tsx ~line 34). |

Correction to an earlier note: the prayer room wall is NOT unmounted. An import
trace that searched only `components/<name>` missed intra-folder `./<name>`
imports.

## TRUE state, verified on main fca5309, 2026-08-25

The section above was produced against a STALE worktree — a `git checkout main`
had silently failed (main was checked out in another worktree), the `&&`
short-circuited, and the audit ran on an old tree. Main was eight migrations
ahead. Three of the seven sessions were already built and merged.

**NEXT MIGRATION IS 184.** Note 181 is ALREADY duplicated on main
(`181_prayer_room_seat_catalogue.sql` and `181_shared_households.sql`) — the
collision this doc warns about happened again while the warning was being
written.

| Session | Real state | Remaining |
|---|---|---|
| 1 Prayer room | **Largely DONE and merged.** `chrome.tsx` (module masthead + tabs), `people.tsx` 289 lines (10a/10b), `person-profile.tsx` 471 lines (11a), `evaluators.tsx` 567 lines (12a/12b) — all built, all carrying Masthead/NeedsYou, all mounted in `prayer-room-client.tsx`. Migration 181 added the seat catalogue. | Confirm 9a set drawer against the frame. Old `calendar.tsx` still coexists with the wall — decide if it goes. |
| 2 Communications | **Not started.** No `messages` table, no reconciliation doc. | All of it. Reconciliation doc FIRST. |
| 3 Training | **Largely DONE and merged.** `roster-tab.tsx` 634 lines (14a), `grades-matrix.tsx` 311 lines (14b), `applicant-review.tsx` (14c), migration 179 moved grades onto billing_courses. | 15a form builder — no SHOWS WHEN conditional UI exists in the admin builder. |
| 4 Bookings | **DONE and merged, then evolved past the frame.** PR #223 rebuilt the calendar as 3c; PR #234 split it — spaces get the timeline (`bookings/spaces/day-timeline.tsx`), vehicles get a portal. | Nothing. Close this session. |
| 5 Billing | 9a + 9b only. No Xero **webhook** route (only callback/connect/disconnect/invoices/organisations/status). No `awaiting_approval`. | 18b, 21b, 21c, 22a, 22b. |
| 6 Outreach | Import UI and API exist. **Zero duplicate / idempotency / batch-id / undo guards — confirmed on real main.** Re-running an import silently doubles the numbers. | The guard is a live data bug, worth doing before the frames. |
| 7 Public + routes | 26 of 75 admin routes still lack `.ffsa-screen`. Generic `e/[slug]/storefront.tsx` has zero editorial markers. No mobile tab bar. | 4c, 4d, 26 routes, then delete the scaffold. |

### Process lesson

`git checkout main && git reset --hard origin/main` is unsafe in a repo with
many worktrees: main is often checked out elsewhere, checkout fails, `&&`
short-circuits, and the audit silently reads a stale tree. **Audit from a
worktree created fresh off `origin/main`, and print the HEAD sha first.**

## Org chart & OKRs (doc 18) — step H built 2026-10-18 (migration 250, NOT yet applied)

`18-org-and-okrs.md` arrived with the October design export and reads as
greenfield. It is not: `staff_ministries` (126) is its `teams`, and the 182
OKR tables are its `objectives` / `key_results` / `kr_checkins`. **Read
`95-org-okrs-reconciliation.md` before starting step H** — it maps every
proposed table onto what exists and proposes H as an extension, not new tables.
Steps I and J need frames 40a–43b, which are not yet in `design/`.

Step H: migration `250_org_structure.sql` + `/org-chart/import` review screen.
Structure columns on `staff_ministries`, role columns on
`staff_ministry_members`, membership history by trigger, `reporting_lines`,
`org_layout`, `org_changes` (empty), `org_edit_log`, `okr_shepherds`, OKR
columns, `okr_teams` retired, `org.manage` reused. Details and the manual
steps after applying are at the end of doc 95. I and J not started.
