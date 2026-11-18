# Training on a phone, for staff — build spec

Design: turns 48–49 of `FFSA Hub Redesign.dc.html` (boards 48a–48i, 49a–49c).
**Read `22-training-code-map.md` first — it maps this onto the live code and wins where they disagree.** FFSA skin ("Movement,
Quiet") with the working patterns proven on Missio (`20-missio-build-guide.md`).
Desktop Training screens (3b, 14a–17b, 27a) are unchanged; the phone is for what staff
do between sessions. Stack: Next.js · Tailwind · Supabase, same app, responsive routes.

---

## 1. Principles

1. **Tabs follow the role** (Missio M10). Same URLs, different bottom bar.
2. **Today is a to-do list, not a dashboard.** Built only from signals the Hub already
   has. Every line deep-links to the screen that does the work.
3. **One yellow band per screen** — the single most overdue thing for this person.
4. **The work comes to them** — Monday briefing on WhatsApp (staff only).
5. **Edit where it's sent** — every send shows the real email with an Edit button.
6. **The student always knows where she is** — the four arrival steps are shown to her too.
7. Phone rules: 390px, no horizontal scroll at 360/390/430, 44px+ targets, tables → lists,
   modals → bottom sheets (`<dialog>`, focus trap, Esc). Square corners, no shadows on UI.

## 2. Roles and tabs (48a, 48h, 48i)

**In the app (48i):** one Hub-wide bottom bar; a **Training** tab shows only for Training staff,
and the role tabs below become a top switcher inside it. Students use the existing My Schools.

| Who | How it's granted | Tabs |
|---|---|---|
| Training director | permission `training.director` | Today · Schools · Applicants · People · More |
| School leader | `school_staff.role = 'leader'` | Today · Students · Applicants · Grades · More |
| School staff | `school_staff.role = 'staff'` | Today · Students · Grades · More |
| Walking with | `student_mentors` row (relationship) | Today · My students · Grades · More |

RLS helpers: `is_training_director()`, `led_school_ids()`, `staff_school_ids()`,
`walking_with_student_ids()`. Full matrix on 48h. Never rely on hiding UI.

## 3. Today (48a)

`GET /training/today` assembles items per user from:
check-ins overdue (≥14 days) · `needs_care` flags unanswered · grades ungraded with due date ·
fee balances (Xero sync) · references late · applicants waiting >7 days for decision ·
arrival steps stalled · staff with no check-ins in 14 days (director only).
Each item: `kind`, `title`, `meta`, `href`, `severity`. Highest severity → the yellow band.
Ticking hides an item for the ISO week (`today_dismissals`: user_id, item_key, week).

## 4. Monday briefing (48b) — on Slack for now

Slack DM from the Hub bot every Monday 07:30 SAST, built from §3. Uses the existing
`users.slack_user_id` and per-module mute (`notification_preferences.muted_modules`, module
`training`). No linked Slack → push. Totals and first names only; buttons deep-link into the
app. "All clear this week" when empty. Students never get it. WhatsApp can replace Slack later
with the same content.

## 5. Weekly check-in (48d)

```
student_checkins
  id, student_id, school_id, by_staff_id, week_of (date, Monday),
  contact ('met'|'called'|'no_reach'), mood ('hard'|'okay'|'good'|'great'),
  note_for_student (text, nullable), note_staff_only (text, nullable),
  needs_care (bool), care_answered_by, care_answered_at, created_at
```
- One per student per week (unique `student_id, week_of`; edits allowed same week).
- Missed week = no row. Charts draw a gap, never zero.
- `note_for_student` shows in her portal. `note_staff_only` is readable by its author, the
  school leader, the training director, and whoever walks with her — enforced by RLS
  (or split into a separate table if column-level RLS gets awkward).
- `needs_care` → top of the school leader's Today until answered.
- Writes a `journey_events` row.

## 6. Students (48c)

List filters: All · No check-in · Owes · Ungraded · Unassigned. Record tabs: Journey ·
Check-ins · Grades · Fees · Mail. Journey = `journey_events` (same table as Missio),
written by the code that does each action; only notes are hand-typed. Call / WhatsApp
(`wa.me` draft from the staff member's own phone) / Email (16b compose as a sheet).
Fees are read-only on phone except "send a reminder".

## 7. Applicants (48e)

Pipeline counts (New · Refs · Interview · Decide); the stage needing action is yellow and
replaces the band. Answers at 15px. Decision bar pinned. Accept sheet lists what happens
(email, deposit scheduled, arrival steps start) and shows the real **Accepted** moment:
- Level 1: `personal_line` for this send only (stored on `message_sends`).
- Level 2: edit the school's wording (15c) → `school_message_moments.source = 'school'`.
Preview renders with her real values, never braces. Next/prev through the Decide list.

## 8. Grades (48f)

Course list → one course → tap student → letter keypad (A, A−, B+ … D−, F, W, I, P — the grades the DB allows; no A+) → Save & next.
Only courses you teach are editable (leaders: all in their school). **Offline-first:**
queue writes in IndexedDB, show "N waiting to sync", retry on reconnect. Each grade writes
a `journey_events` row. Ungraded = empty white square.

## 9. Arrivals (48g)

```
arrival_steps (view or table)
  student_id, accepted_at, deposit_paid_at, travel_ready_at, arrived_at,
  stalled_reason (text, nullable), stalled_since
```
- Accepted from the decision; Deposit from Xero match; Visa & flights when she uploads
  them in her portal (or "not needed"); Arrived ticked by whoever picks her up.
- Stalled step = hatched amber + reason in words.
- She sees the same four steps on her portal page (link in every email).
- Nudge sheet: email (record) or "WhatsApp from my phone" (`wa.me`, logged as such).
- Max one automatic reminder per day; quiet hours 20:00–07:00 in her timezone.

## 10. Build order

1. Role → tabs shell + RLS helpers (48h).
2. `journey_events` for Training + student list/record (48c).
3. Check-ins (48d) — the habit everything else leans on.
4. Today (48a) from existing signals.
5. Grades on phone with offline queue (48f).
6. Applicants on phone + edit-where-sent (48e).
7. Arrival steps + student portal steps (48g).
8. Monday briefing (48b) once WhatsApp foundation from Missio is live.

## 11. Decisions (agreed 18 Nov 2026)

- **A student can have more than one staff member walking with her.** `student_mentors`
  is many-to-many (`student_id`, `staff_id`, `starts_on`, `ends_on`). All of them see
  everything about her; a check-in from any of them counts for the week; "needs care" and
  her "I'd like to talk" requests go to all of them, and the first to tap "I'll take it" owns it.
- **Outreach leaders never see staff-only notes**, on the field or after. Enforce in RLS:
  outreach-leader access grants no read on `note_staff_only`.
- **The student portal gets its own phone pass** → turn 49, §12 below.

## 12. Student portal on a phone (turn 49)

Tabs once she's at school: **Home · Grades · Fees · People**.

**49a · Before she arrives** — `/s/<token>`, no login. Personal token valid until her start
date, re-sent in every email. Shows the four steps from §9 with one "now" step in the
yellow band. Deposit page: amount, exact reference, bank details with copy buttons,
international-transfer note (ZAR, sender pays fees). "I've paid" only notifies the school;
the step completes on the Xero match. Visa & flights form: needs visa yes/no/not sure,
flight number, landing date/time, ticket upload (photo/PDF) → fills `travel_ready_at`.
Visa-required countries get a checklist + downloadable invitation letter.

**49b · At school** — sign-in by email magic link. Home: today's sessions (from the school
timetable plus her own prayer-room/practice bookings), the latest `note_for_student` with
who wrote it, a fees line. Grades: letter + lecturer comment (from 48f), ungraded = empty
square. Fees: read-only schedule from 27a in plain words, "how to pay" for the next charge;
support raising mentioned, never handled.

**49c · People** — everyone walking with her (WhatsApp only if the staff member allowed
their work number, otherwise email), school leader, school office. "I'd like to talk" sheet:
how soon (today / this week / whenever) + optional text → a `student_checkins`-linked
`talk_requests` row (`student_id`, `urgency`, `text`, `taken_by`, `taken_at`), shown as
"needs care" on 48a for her walkers and the school leader. "Today" also WhatsApps them.
112 line shown.

**She never sees:** staff-only notes, mood ratings, other students, internal interview notes.

Build after §10 step 7 (arrival steps), reusing the same data.
