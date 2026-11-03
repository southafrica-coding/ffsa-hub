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

**Home shortcut** (`shortcut.ts`, UX only): shown to people with at least one current enrolment (a head-only count, remembered per user for offline) or who hold the web's Training module (admin, `program_leader`, any `schools.*` permission).

Grade maths in `logic.ts` mirrors `src/services/schools.ts` (`gradeToPoints`, `calculateGPA`) and the web detail page's credits earned/attempted.
