# Schools LMS — slice 1 (content skeleton)

Branch `feat/schools-lms-content-slice-1`. Migration **305**
(`supabase/migrations/305_schools_lms_content.sql`). **Not applied** to prod or
any shared Supabase project — apply only when Jack says so (dashboard SQL
editor, per the usual process).

## What shipped

- **Tables** `lms_courses` → `lms_modules` → `lms_lessons`, program-scoped,
  ordered (`sort_order`), each with a `published` flag. A lesson is
  `rich_text` (`body`) or `link` (`link_url`), enforced by a CHECK.
- **RLS** (no new permission keys):
  - Edit + read drafts: `can_manage_program_applications(program)` OR
    `has_schools_access(program)` — the same people `userCanManageProgram` accepts.
  - Read published only: `is_program_staff(program)`, or an enrolled student
    (`removed_at IS NULL`, status not `dismissed` / `decided_to_leave`).
  - A lesson is visible to readers only when the lesson, its module, and its
    course are all published. `anon` has no grants.
- **Service** `src/services/lms-content.ts`; pure helpers (validation,
  ordering, publish filtering, access derivation) in
  `src/lib/schools/lms-content.ts`.
- **API** (user client only, RLS is the second gate):
  - `…/programs/[programId]/lms/courses` GET / POST, `courses/reorder` POST
  - `…/lms/courses/[courseId]` GET / PATCH / DELETE, `…/modules` POST, `…/modules/reorder` POST
  - `…/lms/modules/[moduleId]` PATCH / DELETE, `…/lessons` POST, `…/lessons/reorder` POST
  - `…/lms/lessons/[lessonId]` PATCH / DELETE
  - Publish toggles are `PATCH { published }`.
  - Student: `GET /api/my-schools/[enrollmentId]/lms` — own, active enrolment, published tree.
- **Leader UI**: new **Classroom** tab on the school page
  (`classroom-tab.tsx`) — create courses / modules / lessons, reorder with
  up/down, publish/unpublish, delete. Shown only to `viewer.canManage`.
  Staff-scoped viewers never reach `ProgramDetail` (they get the assigned
  applicants view), so they have no Classroom tab. The existing **Courses**
  tab (billing phases, `billing_courses`) is unchanged.
- **Student UI**: read-only Classroom section on `/my-schools/[enrollmentId]`.
  Rich text is sanitised server-side (event-description sanitiser); plain text
  keeps line breaks. Links open in a new tab with `rel="noopener noreferrer"`.
  The section is hidden if the tables are not there yet.

## Out of scope (later slices)

- Grading / marks / official letters
- Assignments, submissions, due dates
- File uploads / Drive attachments
- Google Classroom sync
- Progress tracking / completion
- Templates library / AI course agent
- Mobile app surfaces
- Editing lesson text in the UI (the PATCH API supports it; the tab only creates, reorders, publishes, deletes)

## Separate drafts

PRs #501 / #506 / #509 (outlines / graders on `billing_courses`) are a
different design and remain separate, dormant drafts. Nothing here merges,
rebases onto, or copies from them.

## Tests

- `src/lib/schools/lms-content.test.ts` — ordering, reorder validation,
  publish filtering, content-type validation, access, sanitising.
- `src/app/api/schools/programs/[programId]/lms/courses/route.test.ts` and
  `src/app/api/my-schools/[enrollmentId]/lms/route.test.ts` — route gates.
- `supabase/tests/lms_content_rls.sql` (+ `src/lib/schools/lms-content-rls.test.ts`
  wrapper, which skips without local Postgres):

  ```bash
  dropdb --if-exists lms_content_rls && createdb lms_content_rls
  psql -v ON_ERROR_STOP=1 -d lms_content_rls -f supabase/tests/lms_content_rls.sql
  ```
