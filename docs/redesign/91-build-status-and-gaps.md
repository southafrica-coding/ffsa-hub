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
| Prayer room UI — masthead, 9a, 10a, 10b, 11a, 12a, 12b | 🔵 built on `redesign/prayer-room-ui`, not yet merged |
| Billing: `billing_mode` (172), generation guard + held-charge queue (173) | ✅ with tests |
| Xero: read side, honest status, per-region org pinning | ✅ |

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
