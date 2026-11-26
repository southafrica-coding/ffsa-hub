# Training phone (turns 48–49) → the live code

Checked against `ffsa-platform` **origin/main @ ac944ed8** (18 Nov 2026). Read with
`21-training-phone.md`. Where that spec says "new table", this file says what already
exists and what actually has to change. **This file wins where they disagree.**

---

## 1. Decisions (18 Nov)

| # | Decision |
|---|---|
| 1 | Mapping to the real code is mandatory before any build — this file. |
| 2 | 4d (old mobile student portal) is superseded by 48i/49. Its "Support raised" tile is dropped (turn 27: support raising never goes through FFSA). |
| 3 | POPIA: staff keep pastoral notes and students are told so (§6). |
| 4 | Monday briefing and staff alerts go on **Slack** for now (Hub bot DMs), push as backup. WhatsApp later. |
| 5 | Staff: a **Training tab** in the Expo app, shown only to Training staff; role sections in a top switcher (48i). |
| 6 | Students: **extend My Schools** in the app; 49a pre-arrival steps live on the **website** (applicants aren't in the app — 3 Nov rule). |
| 7 | Several staff can walk with one student. Outreach leaders never see staff-only notes. |

## 2. What already exists (reuse, don't rebuild)

| Design need | Already in the code |
|---|---|
| Schools, courses, students | `programs`, `courses`, `billing_courses`, `enrollments` (006, 098, 179) |
| Enrolment states for arrivals | `enrollments.status`: `waiting_for_arrival` · `arrived` · `dismissed` · `decided_to_leave` · `graduated` |
| Grades | `grades` (`letter_grade` A…F + W, I, P — **no A+**), `graded_by`, `graded_at`, `notes` (staff-only, never sent to phone) |
| School leader role | `program_leaders` + `is_program_leader()`, `has_schools_access()` (145) |
| Permissions | `schools.view`, `schools.manage`, `schools.manage_enrollments`, `schools.view_applications`, `schools.approve_applications`, `schools.manage_attendance` |
| "Walking with" (one person) | `enrollments.assigned_staff_id` + RLS "assigned staff can read" (052) |
| Applicants + decision | `application_responses` (+ `assigned_staff_id`), statuses, references, templates (007, 025, 027, 029) |
| Message "moments" | `program_email_templates` (`email_type`, `enabled`, `subject`, `body` null = FFSA default) (146, 147, 238) |
| Arrival per course | `enrollment_course_arrivals` (259) |
| Fees + Xero | school billing engine (095), Xero tracking (235, 291), `reconcile-payments` cron |
| Journey timeline | `activity_events` per **contact** (043). `users.contact_id` links a student. |
| Slack DMs | `users.slack_user_id` (+ link audit, 187), `src/lib/slack/client.ts` `openConversation`/`postMessage`, pattern in `src/lib/vehicles/requester-notify.ts` and `prayer-room/booking-alerts.ts`; per-module mute `notification_preferences.muted_modules` |
| Push | `src/lib/push/*` (Expo push, categories, `device_push_tokens` 288) |
| Daily jobs | Vercel crons incl. `/api/cron/school-reminders` (07:00 UTC) |
| Phone app | `apps/mobile` (Expo SDK 58, expo-router). Tabs in `src/features/shell/tabs.ts` (has `visible(me)` rule). My Schools = `app/(app)/schools/` (read-only, student + staff gate, offline cache). `useMe`, `useCan`, `SectionBar`, `ListRow`, theme tokens (light + dark). |

## 3. What has to change

**Migrations** (numbering: Missio is at 331–333 on main and more Missio branches are open —
take the next free number at merge time, never reuse one).

1. `enrollment_staff` — many-to-many "walking with":
   `enrollment_id`, `user_id`, `starts_on`, `ends_on`, `added_by`. Backfill one row from every
   non-null `enrollments.assigned_staff_id`. Keep `assigned_staff_id` for now (web reads it);
   new code reads the join table; drop the column in a later cleanup. Extend the 052 RLS to
   "is on `enrollment_staff`" so every walker reads the enrolment.
2. `student_checkins` — keyed on `enrollment_id`: `program_id` (copied by trigger),
   `week_of` (a Monday), `by_user_id`, `contact`, `mood`, `note_for_student`, `needs_care`,
   `care_taken_by`, `care_taken_at`. Unique per (`enrollment_id`, `week_of`, `by_user_id`),
   so two walkers can each check in the same week. Students never SELECT it; they read
   `my_checkin_notes()` (note + author + date only). Talk requests get their own table in T8.
3. `student_checkin_private` — `checkin_id`, `note_staff_only`. **Separate table**, so RLS can
   keep it from students and outreach leaders without column-level tricks. Readable by:
   author, anyone on `enrollment_staff` for that enrolment, `is_program_leader(program)`,
   training director. Nobody else — explicitly not outreach leaders.
4. `grades.comment_for_student` (text, nullable). `grades.notes` stays staff-only.
5. `today_dismissals` — `user_id`, `item_key`, `iso_week`.
6. No new permission key: "training director" = `has_schools_access()` (admin or
   `schools.manage`). Also reuse `program_staff` / `is_program_staff()` (migration 304) for
   "school staff".
7. Arrival steps: **no new table.** Derive from data: accepted (application decision),
   deposit (billing charge paid via Xero), travel (`enrollment_travel`: `enrollment_id`,
   `needs_visa`, `flight_number`, `lands_at`, `ticket_path`, `visa_status`), arrived
   (`enrollments.status = 'arrived'`). Stalled reason computed in a view
   `enrollment_arrival_steps`.
8. Personal line on a send: add `personal_line` to whatever row records a school email send
   (check `program_email_*` send log in T6).

**`activity_events` — do NOT use for Training (found while building T1).** Migration 043's
policy "Auth users can read activity events" lets **every signed-in user, students included,**
read every row. Check-ins, care flags and talk requests must never go there. The student's
journey (48c) is built from the school tables in T3 instead. ⚠️ This also means existing
`note_added` / `email_*` CRM events are readable by any signed-in user today — a separate
fix, outside Training, worth doing before more students are in the app.

**Phone app**
- `tabs.ts`: add `{ id: "training", segment: "training", label: "Training", icon: GraduationCap, visible: me => hasTrainingAccess(me) }`, second position. Extend `TabId` and `setTabBadge`.
- New route folder `app/(app)/training/` + `src/features/training/` (own slice, own README,
  same contract as schools). Top switcher per role (48i).
- Grades: offline write queue — reuse finance's outbox pattern (`features/finance/outbox`).
- My Schools: add sections This week · From the people walking with you · Fees · People +
  "I'd like to talk" sheet (49b/49c). Read `note_for_student` and `comment_for_student` only.
- Theme tokens only (light + dark). Run `npm run types:sync` after each migration.

**Website**
- 49a pre-arrival page `/s/[token]` (public, token = signed, expires at start date).
- 48b settings live on the existing `/profile` notification settings (module mute "Training").

**Slack (decision 4)**
- Monday briefing: new cron `/api/cron/training-briefing` (Mon 05:30 UTC = 07:30 SAST).
  Builds each person's Today list (§T3), DMs via `openConversation` + `postMessage` with
  Block Kit buttons deep-linking into the app (`ffsahub://training/...`) with web fallback.
  Skip anyone who muted module `training`; no `slack_user_id` → push instead.
- Event DMs (not broadcasts — scoped to the people involved): `needs_care` → school leader +
  all walkers; `talk_request` urgency "today" → all walkers. Add a `training` push category.
- Totals and first names only in Slack. Never note text.

## 4. Mismatches fixed in the design

- Grade keypad had A+ and missed C−, D+, D−, W, I, P → fixed on 48f.
- Per-role bottom bars on 48a–48g and 49 → superseded by 48i.
- 48b WhatsApp → Slack DM (redrawn).
- "journey_events" (Missio name) → `activity_events` for Training.

## 5. Risks to watch

- **Two "walking with" sources** during the transition. Every new query must use
  `enrollment_staff`; add a test that fails if `assigned_staff_id` is read in `features/training`.
- **Private notes leaking through joins or `activity_events.payload`.** RLS tests per role,
  including outreach leader and the student herself.
- **Six tabs** for Training staff — check labels at 360px and with large text.
- Slack users not linked → briefing silently missing. The cron logs who got push instead.

## 6. POPIA — mandatory before check-ins go live

- Add to the student privacy notice (website + the policy linked from the app's Me screen),
  in plain words, e.g.:
  > *"Staff who walk with you keep short notes from your check-ins so they can care for you
  > well. Some notes are only for staff. You can ask to see the information we hold about you,
  > and we'll respond as the law requires."*
- Staff guidance on the check-in screen (one line under the staff-only box): *"Write what
  you'd be comfortable with her reading one day."*
- Health or family details only when needed for care. No diagnoses.
- An access request (POPIA s23) is answered from an export that **includes** staff-only
  notes — the design rule "no hint they exist" is about the UI, not about refusing a request.
- Retention: decide how long check-ins are kept after graduation (suggest 2 years, then delete
  private notes, keep mood/date counts). Needs a decision.
- Have the wording checked by whoever reviews POPIA for Missio.

## 7. Build prompts (paste one at a time into Claude Code at the repo root)

Each prompt: work on a new branch from `main`, read `CLAUDE.md`, `apps/mobile/AGENTS.md`
(for app work), this file and `21-training-phone.md`, and the named design boards. Don't run
`eas`. Finish with the repo's checks.

**T1 · Foundations (no UI). ✅ Built 18 Nov — migration 334, branch `feature/training-foundations`.** Branch `feature/training-foundations`. Migrations 1, 2, 3, 5 and
the `activity_events` types from §3, with RLS exactly as §3 describes, a backfill of
`enrollment_staff` from `assigned_staff_id`, and SQL helpers `walking_with_enrollment_ids()`
and `is_training_director()`. Write RLS tests for: walker, second walker, school leader, other
school staff, outreach leader, the student, a different student. Regenerate types.

**T2 · Training tab shell (app).** Branch `feature/training-tab`. Add the Training tab to
`tabs.ts` with `visible(me)` (Training module holders or anyone on `enrollment_staff`), a new
`training/` route + `features/training` slice with README, the role-based top switcher from
48i, and empty states. Badge = Today count. Light and dark.

**T3 · Students + check-ins (app + API).** Branch `feature/training-checkins`. 48c list and
record (Journey from `activity_events`), 48d check-in form and history. Writes go through a
Next API route that inserts `student_checkins` + `student_checkin_private` + an
`activity_events` row in one transaction. "Needs care" → Slack DM + push to the school leader
and all walkers. Include the POPIA line from §6 on the form.

**T4 · Today (API + app).** Branch `feature/training-today`. `GET /api/training/today` builds
items from: check-ins overdue ≥14 days, unanswered needs-care, ungraded with due date, fee
balances, late references, applicants waiting >7 days, stalled arrivals. One item becomes the
band. `today_dismissals` per ISO week. Render 48a in the Training tab.

**T5 · Monday briefing on Slack.** Branch `feature/training-briefing`. Cron
`/api/cron/training-briefing` (add to `vercel.json`, Mon 05:30 UTC) using T4's builder. DM per
§3 Slack; module `training` mutable on `/profile`; push fallback; "All clear this week".

**T6 · Grades + applicants on the phone.** Branch `feature/training-grades-applicants`.
48f with the real grade list and an offline queue modelled on the finance outbox; add
`grades.comment_for_student`. 48e queue, application, accept sheet showing the real
`program_email_templates` email with a personal line (add the column to the send log).

**T7 · Arrivals + pre-arrival page.** Branch `feature/training-arrivals`.
`enrollment_travel`, view `enrollment_arrival_steps`, 48g tracker + nudge, and the public
website page `/s/[token]` (49a) with deposit details from the billing engine and the travel form.

**T8 · My Schools extended (app).** Branch `feature/my-schools-week`. 49b/49c as sections of
the existing enrolment screen: this week, "from" notes (`note_for_student` only), fees,
people, "I'd like to talk" sheet → `student_checkins` row with `source = 'student_request'`
+ Slack/push to walkers. Keep the read-only/offline behaviour of the existing screens.

Ship T1 → T4 first (useful on their own). T5–T8 after, in any order once T1 is in.
