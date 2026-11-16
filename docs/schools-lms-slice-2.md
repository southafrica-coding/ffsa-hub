# Schools LMS — slice 2 (assignments, submissions, grading)

Branch `feat/schools-lms-assignments-slice-2`. Migration **310**
(`supabase/migrations/310_schools_lms_assignments.sql`). **DO NOT APPLY** until
Jack says so. Previews share the prod database, so nothing here has been run
against `<project-ref>` or any shared project. Apply by hand in the
dashboard SQL editor (after 305 and 308), per the usual process.

Goal: replace Google Classroom around live lectures. Staff set assignments,
students hand in text, a link or files (and may resubmit), staff grade with
points and feedback, students see released grades. Live lectures are unchanged.

## Review fixes folded into 310 (Hub Data F1–F5)

310 is unapplied, so these live in 310 itself (no follow-up migrations):

- **F1 (high)** — 310 redefines 305's `lms_can_edit` with the
  `program_leader` *role* scoped to the program (`scope_type IS NULL` or
  `program` + this id). 305 went through `can_manage_program_applications`,
  whose last branch accepts that role for every program, so a leader of one
  school could edit another school's classroom and, with 310, grade it.
  This also closes that leak for 305's course / module / lesson policies, on
  purpose. `can_manage_program_applications` itself (applications) is
  unchanged and out of scope.
- **F2** — a submitted attempt is never deleted at any depth. An
  assignment or course delete that would cascade into one raises 23503; a
  direct delete raises 23514. Drafts still cascade.
- **F3** — grade insert / update / delete refuse the grader's own attempt.
- **F4** — `lms_stamp_created` sets `created_at` on all four tables and
  `created_by` on assignments, and freezes them on update.
- **F5** — `lms_submissions_content_guard`: an attempt becoming submitted
  needs at least one piece of content of an accepted type
  (`empty_submission:`); extra content is allowed.

## Decisions (Jack, 9 Nov 2026) and how they are enforced

| Decision | App | Database |
| --- | --- | --- |
| Leaders **and** program staff grade and release; staff grade every classroom student in their school | `authorizeAssignments(…, "grade")` = `canManage \|\| isStaff` | `lms_can_grade()` = `lms_can_edit() OR is_program_staff()` on grade and submission policies |
| `allow_late` per assignment; off → no submit after `due_at` | submit route → `409 late_not_allowed` | `lms_submissions_guard` raises `late_not_allowed` on any insert/update to `submitted`, resubmissions included |
| Points out of a required `max_points > 0`, plus feedback | `validateGradeInput` → 400 outside 0..max | CHECK `max_points > 0`; `lms_grades_guard` checks `0 ≤ points ≤ max_points`; `max_points` cannot drop below an existing grade |
| Resubmit any time (even after release); each is a new row; earlier attempts, files and grades immutable; highest `attempt_no` is current | `submitPlan` → draft or attempt N+1; history UI | trigger numbers `attempt_no`; submitted rows can't be updated or deleted; files only on drafts; a superseded attempt's grade is frozen (releasing a held one is still allowed) |

## Schema (310)

- `lms_assignments` — `course_id` → `lms_courses` CASCADE, optional `lesson_id` →
  `lms_lessons` SET NULL (same course, checked by trigger), `title`,
  `instructions`, `due_at`, `allow_late` (default true), `submission_types`
  (non-empty subset of text/link/file), `max_points`, `published`, `created_by`.
- `lms_submissions` — one row per attempt. `enrollment_id` → `enrollments`
  **RESTRICT**. `attempt_no`, `body_text`, `link_url` (`^https?://`), `status`
  draft/submitted, `submitted_at`, `is_late` (server-set). UNIQUE
  (assignment, enrolment, attempt_no) + at most one draft per pair.
- `lms_submission_files` — `submission_id` CASCADE, `storage_path` (unique,
  shape-checked), `file_name`, `mime` (allowlist), `size_bytes` (≤ 20 MB). ≤ 10
  per attempt. No UPDATE grant.
- `lms_grades` — `submission_id` UNIQUE **RESTRICT**, `points`, `feedback`,
  `graded_by`/`graded_at` and `released_by` stamped by trigger, `released_at`.
- View `lms_current_submissions` (`security_invoker = true`): latest
  **submitted** attempt per student per assignment. Drafts never count.
- RPC `lms_grading_roster(program)` (SECURITY DEFINER): classroom students and
  their names, for graders only. Needed because staff can only read
  `enrollments` rows assigned to them (304).
- All helpers are SECURITY DEFINER, `search_path = ''`, EXECUTE revoked from
  PUBLIC/anon and granted to authenticated. Trigger functions are not callable.
- Grants: anon has nothing; authenticated has only what the policies need
  (no TRUNCATE/REFERENCES/TRIGGER, no UPDATE on files).

### RLS summary

| | assignments | submissions | files | grades | storage objects |
| --- | --- | --- | --- | --- | --- |
| Editor (`lms_can_edit`) | all, incl. drafts; write | read submitted | read | read, write, delete (current attempt) | read |
| Program staff | read published | read submitted | read | read, write, release | read |
| Student | read published in published course | insert own; edit/delete own **draft**; read own | add/remove on own draft; read own | read own **released** | upload/remove own draft paths; read own |
| Other student / other school | — | — | — | — | — |
| anon | 42501 | 42501 | 42501 | 42501 | — |

Drafts are private to the student: graders never see them.

Editors cannot edit or delete a student's attempt (submitted rows are
immutable for everyone, and the delete policy is draft-only).

### Storage

Private bucket `lms-submissions` (20 MB, same mime allowlist). Path
`{program_id}/{assignment_id}/{submission_id}/{random_uuid}.{ext}` — ids only,
no user id or email (PR #531's lesson). Bucket policies admit an object only
when an `lms_submission_files` row names that exact path and the caller may
read (graders, owner) or write (owner, draft only) it.

Upload: the student's client inserts the file row (RLS + trigger check size,
type, count, path shape), then the route signs an upload URL with the service
role. Download: the route reads the file row through the caller's client, then
signs a **5-minute** URL. The service role is used only in
`src/lib/schools/lms-storage.ts`, only after that read or insert succeeded,
and never with a path from the request body. Submit checks every draft file
actually landed in storage (else 409 `upload_incomplete`).

File names and types:

- Registering a file whose name's extension does not match its declared (or
  extension-derived) type is a 400 `file_type_mismatch` (`payload.exe` sent
  as `application/pdf` is refused). Nothing is created.
- A download is always named `<cleaned base name>.<extension of the stored
  type>` (`downloadFileName`), never with the extension in the stored name.
- Android's `image/heif` / `.heif` is stored as `image/heic` (browser and
  server both map it before the allowlist check), so the bucket and the 310
  CHECK are unchanged.
- `.doc` / `.ppt` can carry macros. They stay allowed (no behaviour change);
  downloads are attachments and Office opens them in Protected View.

## API

Staff, `/api/schools/programs/[programId]/lms/` (user client; 401/403/404):

- `assignments` GET (graders; per-assignment counts) / POST (editors)
- `assignments/[assignmentId]` GET / PATCH (incl. `published`) / DELETE
  (409 once anyone has submitted — unpublish instead)
- `assignments/[assignmentId]/submissions` GET — one row per student:
  missing / submitted / late / graded / released
- `assignments/[assignmentId]/students/[enrollmentId]` GET — attempt history
- `submissions/[submissionId]/grade` PUT `{ points, feedback?, release? }`
  (409 if a later attempt exists)
- `assignments/[assignmentId]/release` POST `{ submission_id? }` — one or all
- `files/[fileId]` GET → `{ url }` (5 min)

Student, `/api/my-schools/[enrollmentId]/lms/assignments` (own active enrolment):

- GET list with bucket (to do / submitted / graded), current attempt, released grade
- `[assignmentId]` GET — instructions, draft, attempts (released grades only)
- `[assignmentId]/draft` PUT / DELETE
- `[assignmentId]/submit` POST — draft → submitted, or attempt N+1 (409 `late_not_allowed`)
- `[assignmentId]/files` POST `{ file_name, mime, size_bytes }` → signed upload
- `[assignmentId]/files/[fileId]` GET (5-min URL) / DELETE (draft only)

DB errors are mapped in `dbError()`: RESTRICT / the F2 guard → 409
`has_student_work` with a sentence that names what was being deleted
(assignment, course, enrolment, school — adapted from #501's
`gradeMarksRestrictMessage`), late → 409, any unique clash (23505) → 409,
frozen / immutable → 409, `empty_submission` → 400, other checks → 400, RLS →
403, missing tables → 503 `lms_schema_not_applied`.

Deletes that touch student work:

- Assignment DELETE and the slice-1 **course DELETE** check for submitted
  attempts first and answer 409 (the course check is skipped only while the
  310 tables do not exist yet). The DB's 23503 is the backstop.
- The permanent enrolment delete and the school (program) delete map a
  23503 from 310 to a 409 sentence instead of a 500.

Re-grading is optimistic: the grade drawer sends `expected_updated_at` (the
grade's `updated_at` it showed, or null if it showed none). A mismatch is 409
`grade_changed` and nothing is written.

An UPDATE that matches no row is re-checked, because RLS (F3) hides the
grade row from a grader's own attempt and that also looks like "0 rows":
your own attempt (`lms_submission_is_mine`) → 403 `not_allowed`; the grade
still there with a different `updated_at` → 409 `grade_changed`; anything
else → 403 `not_allowed`. A first grade on your own attempt fails the INSERT
policy and is 403 `not_allowed` too.

### Preview deployments

Previews share the prod database and the `lms-submissions` bucket, and a
submitted attempt or a frozen grade can't be deleted afterwards. Every write
route calls `previewWritesDisabled()` (`src/lib/schools/lms-http.ts`, ported
from #501) first and returns 403 `preview_writes_disabled` when
`VERCEL_ENV=preview`: draft PUT / DELETE, files POST, file DELETE, submit
POST, assignments POST, assignment PATCH / DELETE, release POST, grade PUT,
and the slice-1 content writes: course POST / PATCH / DELETE, module POST /
PATCH / DELETE, lesson POST / PATCH / DELETE, and the course, module and
lesson reorders. Reads stay open.

## UI

- **Leaders**: Classroom tab → *Assignments* card under the course list.
  Create/edit (types as checkboxes, due date typed in Africa/Johannesburg
  time, points, accept-late switch, optional lesson), publish toggle,
  per-assignment counts, submissions table (cards on phones), grade drawer
  (current attempt's text, link and files; attempt switcher with earlier
  attempts and their grades; points / max; feedback; Save draft / Release),
  "Release N held grades".
- **Program staff** (staff-scoped school page): the same Assignments card
  without create/edit, below their assigned applicants. Staff who reach the
  full school page (for example because they also hold a schools.* grant)
  get a Classroom tab that shows only Assignments, grade-only
  (`canGradeAssignments = canManage || isStaff`).
- Downloads use `location.assign` on the signed URL (mobile browsers block
  `window.open` after an `await`). When a phone gives a file no type (HEIC,
  Office), the mime comes from the extension; Android's `image/heif` counts
  as `image/heic`, and the file picker offers `.heif`.
- **Students**: `/my-schools/[enrollmentId]` gains an *Assignments* section
  grouped To do / Submitted / Graded with due badges (Late / Closed in red).
  `/my-schools/[enrollmentId]/assignments/[assignmentId]` has instructions, the
  hand-in form for the allowed types with per-file upload progress, Save
  draft, Resubmit after submission or grading, and the attempt history with
  each attempt's released points / max and feedback. Text is rendered as
  plain text; links are http(s) only with `rel="noopener noreferrer"`.

All tap targets are ≥ 44 px; layouts are single-column at 375 px.

## Out of scope

- Quizzes and auto-grading
- Rubrics
- Weighted gradebook and final marks
- Official letters / transcripts (that's #501's domain; `grades` and
  `grade_marks` are untouched)
- Progress tracking / completion
- Video lessons
- Google Classroom import or sync
- Plagiarism checks
- Notifications and emails (no "graded" or "due soon" messages yet)
- Group assignments
- Per-student grader assignment (staff grade everyone in their school)
- The mobile app
- Unreleasing a grade from the UI (the API keeps released grades released)
- Fixing the unscoped `program_leader` branch in `can_manage_program_applications`
  (applications); 310 only scopes it for the LMS

## Reused from / rejected from #501 / #506 / #509

Reused (ideas only, no files copied):

- #506: `ON DELETE RESTRICT` on the enrolment and on graded rows so student
  work is never lost to a cascade.
- #501: plain-sentence 409 for a RESTRICT violation (`gradeMarksRestrictMessage`
  → `lmsRestrictMessage`); 503 when the LMS tables are missing; `no-store`
  on JSON responses.
- #501: draft-then-post grading → `released_at` on `lms_grades`.
- #501: `previewWritesDisabled` (with `json` / `NO_STORE`) in
  `src/lib/schools/lms-http.ts`.
- #509: one grader queue per assignment with a side drawer, cards on phones.

Rejected:

- Hanging grading off `billing_courses` / `grade_marks` / letter grades — this
  slice is points-per-assignment on the `lms_*` tree and leaves finance and
  official grades alone.
- `course_graders` / per-student grader assignment — Jack decided staff grade
  every student in their school.
- `can_post_official` / a separate "official" poster role — any grader releases.
- #509's template library, course builder and AI course agent.

## Tests

- `src/lib/schools/lms-assignments.test.ts` — late logic (both switch values),
  points bounds, type validation, current-attempt selection, row builders,
  path builder has no uid, name/type mismatch, download names, HEIF → HEIC.
- `src/app/api/schools/programs/[programId]/lms/assignments/route.test.ts` and
  `src/app/api/my-schools/[enrollmentId]/lms/assignments/route.test.ts` — 401/403
  for non-members, 404 cross-program, student cannot read another student's
  submission or file, grade hidden until released, resubmit after release →
  attempt 2 with attempt 1 and its grade intact, late blocked with
  `allow_late=false` (incl. resubmits), self-grading is 403 `not_allowed`
  (first grade and re-grade) while a real concurrent change is 409, a
  mismatched upload is 400 `file_type_mismatch`, HEIF uploads, download names
  follow the stored type. Services are an in-memory fake that
  mirrors 310 (`src/lib/testing/fake-lms-assignments.ts`).
- `src/lib/schools/lms-http.test.ts` — every slice-1 and slice-2 write route
  returns 403 `preview_writes_disabled` on a preview and is not blocked
  otherwise; reads stay open; the error mapping.
- `src/app/api/schools/programs/[programId]/lms/courses/[courseId]/route.test.ts`
  — course DELETE 409s on submitted work (pre-check and 23503 backstop).
- `supabase/tests/lms_assignments_rls.sql` + `src/lib/schools/lms-assignments-rls.test.ts`
  — every role (student, other student, staff of this school, staff of another
  school, leader, other leader, a `program_leader` role scoped to the other
  school, anon) with PASS and deliberate FAIL cases on all four tables, the
  view, the roster RPC and storage objects, plus F2–F5. The harness uses the
  live shape of `can_manage_program_applications` (unscoped role branch), so
  the scoped-role case fails if 310's `lms_can_edit` redefine is removed.
  Only ever run it on a throwaway local database:

  ```bash
  dropdb --if-exists lms_assignments_rls && createdb lms_assignments_rls
  psql -v ON_ERROR_STOP=1 -d lms_assignments_rls -f supabase/tests/lms_assignments_rls.sql
  ```

  The vitest wrapper runs it with `sudo -u postgres` (cloud box) or, locally,
  with `LMS_RLS_PGPORT=<port> PG_BIN=<pg bin dir>`; otherwise it skips.
