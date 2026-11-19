# My Schools + My Attendance (read-only)

Routes: `app/(app)/schools/` — a hidden route of the signed-in tabs (not in `TABS`), opened from the Home "My Schools" shortcut or a Home feed item (`/my-schools`, `/my-schools/<id>`, `/my-attendance`; `/my-schools/apply/…` stays on the website).

| Screen | Route | Web equivalent |
|---|---|---|
| My Schools | `/schools` | `/my-schools` |
| Enrolment | `/schools/[id]` | `/my-schools/[enrollmentId]` |
| My Attendance | `/schools/attendance` | `/my-attendance` |

**Data.** Plain reads straight from Supabase with the person's own session (`data.ts`), the same queries the web pages run with the user's client, so RLS decides exactly as on the web. Every read is also filtered to the caller's own `user_id` / `contact_id` (staff whose RLS shows everyone still see only their own here), and columns are listed rather than `*` so staff-only fields (application `admin_notes`, enrolment and grade `notes`) never reach the phone. No endpoint, no writes, no migration.

**Offline.** The last good copy of each screen is kept with finance's `useCachedLoad` (encrypted store, per user) and shown at once with "Last updated …".

**Stays on the website.** Applying (`/my-schools/apply/<programId>`) and the transcript PDF (from the enrolment's web page), via `openWebPage`.

**Who sees My Schools in the app** (`logic.ts` `canSeeMySchools`, UX only; RLS still decides what the screens read). Jack's decision, 3 Nov 2026: in the phone app, only enrolled students and school staff. The website is unchanged.

- **Enrolled student**: at least one non-removed enrolment whose status counts (`ENROLLED_STATUSES`): `waiting_for_arrival`, `arrived`, `graduated` (a graduate still needs grades and the transcript), plus the older words `active`, `on_hold`, `completed`. Not counted: `dismissed`, `decided_to_leave`, `withdrawn`, any status the app doesn't know yet, and applicants with only an application.
- **School staff**: holds the web's Training module per `GET /api/me` (admin / super_admin, `program_leader`, any `schools.*` permission), or is the assigned staff on a non-removed enrolment (a head-only count RLS allows, migration 052). A plain `staff` role alone isn't school staff.

`data.ts` `loadSchoolsTies` reads both facts (Training-module holders are never asked). `shortcut.ts` `useSchoolsAccess` remembers the answer per user (`ffsa.schools.enrolled.v2:<userId>`; v2 because the rule narrowed, the v1 flag is cleared) so it works offline, lets a fresh answer win, and waits for `/api/me` before saying no.

- **Home shortcut** (`useSchoolsShortcut`): shown only once the answer is yes; never shown then hidden while loading.
- **Routes**: `/schools` and `/schools/[id]` sit behind `SchoolsGate` (feed items, notifications and links skip Home). Not eligible: a plain "My Schools is for students and staff of our schools" screen with a button to the website's `/my-schools`. Checking: a loading state. Couldn't tell at all (offline, nothing remembered): the screen shows, with its own offline/error states. `/schools/attendance` is not gated: attendance is check-ins at any event, not school records.

Grade maths in `logic.ts` mirrors `src/services/schools.ts` (`gradeToPoints`, `calculateGPA`) and the web detail page's credits earned/attempted.

**Look (redesign, frames 8.1–8.6).** Every screen draws its own header with the kit's `LargeTitleScrollView` (the list and the gate go back to Home, the enrolment and My Attendance back to My Schools; the stack has `headerShown: false`). Rows sit in kit `ListGroup`s, statuses are `StatusChip`s (always a word), the one yellow band is `NeedsYouBand`. What the kit doesn't have yet lives in `components/parts.tsx` (`Bleed`, `SectionCount`, `GroupRow`, `DateBlock`, `Figure`, `LoadError`, `Freshness`); My History uses the same file. `components/ui.tsx` is the pre-redesign set that Ministries and Staff decisions still import: delete it once they've moved to the kit.
