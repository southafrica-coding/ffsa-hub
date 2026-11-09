# Program staff

Migration `304_program_staff.sql` adds school staff as a separate membership from leaders. It does not change any existing person. Apply it by hand in the Supabase SQL editor. Do not run the switch below as part of that migration.

## How staff is stored

`public.program_staff`, one row per school and person. Removing someone deletes the row.

Not a role column on `program_leaders`. A row in that table is `is_program_leader`, which is `has_schools_access`. A missed filter would give staff leader powers.

Not a `schools.*` permission bundle. Those grants cover the whole program, not “the applicants assigned to me”, and people already hold them by hand.

## Who can add or remove staff

`has_schools_access(program_id)`, the same gate as the leader-team RLS in migration 145:

- `super_admin` and `admin` (`is_admin()`)
- `schools.manage`, global or scoped to that program
- a named leader (`program_leaders`)

`schools.approve_applications` and `schools.manage_enrollments` are not enough. The HTTP routes are:

- `GET /api/schools/programs/:programId/staff`
- `POST /api/schools/programs/:programId/staff` `{ "userId": "..." }`
- `DELETE /api/schools/programs/:programId/staff` `{ "userId": "..." }`

## What staff can do

Staff do not receive `has_schools_access` or `userCanManageProgram`.

They can:

- be chosen as the point of contact for their own program (assignable contacts)
- read applications where `assigned_staff_id` is themselves, and only while they are still staff, a leader, or hold a schools grant for that program. Removing them clears the assignment. A leftover `assigned_staff_id` is not enough.
- write one review per application on `application_staff_reviews`: `notes` and `interview_outcome` of `pending`, `recommend`, `hold`, or `decline`

`PUT /api/schools/applications/reviews`

```json
{ "response_id": "...", "notes": "Spoke on Tuesday.", "interview_outcome": "recommend" }
```

The write uses the signed-in user client. A trigger rejects it unless `auth.uid()` is program staff and the assigned contact. This does not change application status, send email, or enroll anyone. Leaders still decide status through the existing responses route.

They cannot:

- edit application questions, reference slots, reference questions, program email templates, email documents, or program settings (acceptance email included)
- read fee structures, student fees, payments, charge items, billing schedules, or billing plans for that school, except a fee row that is their own as a student

Leaders, `schools.*` holders, and admins keep the school page they already have. A person who is both a leader and staff is still a leader. Finance access does not open the rest of the school: it only adds the fees panel on the staff view.

Leader notes are in `application_admin_notes`. Signed-in users cannot select `application_responses.admin_notes`. Staff do not receive the notes in the application PDF.

## SBI

Program `5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48`. Six people were given `schools.*` rows by hand, including `schools.assignable_as_contact`, and some may also be on Leaders. Leave them there until someone switches them. Until then their current access keeps working, and they stay assignable.

### Move to staff

A leader of that school, someone with `schools.manage`, or an admin calls:

`POST /api/schools/programs/5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/staff/switch`

```json
{ "userId": "<the person>" }
```

The Leaders tab has the same action: “Move to staff”.

The call is one database function, `switch_person_to_program_staff`. It:

1. Inserts `program_staff` if missing.
2. Deletes that person’s `program_leaders` row for this program.
3. Deletes a program-scoped `schools.assignable_as_contact` grant for this program.
4. Clears `assigned_staff_id` on this program’s applications and enrolments for that person.

It does not remove the `school_leader` role. `assigned_by` is either null (the migration 292 backfill) or the person who clicked Add, and a hand grant can look like either, so the role is left in place.

It does not delete any other program-scoped `schools.*` grant (`schools.manage`, `schools.approve_applications`, `schools.manage_enrollments`, and the rest). If the person holds one, a leader gets 403: an admin is needed. An admin (`is_admin()`: super admin or General Admin) can still run the switch, and those other grants stay. Take them off by hand on Users & Roles if the person should become staff only. Unscoped grants and a global `program_leader` role are also left alone. A super admin cannot be switched. Running it twice is a no-op once they are already staff and not a leader.

### Reviewed SQL

The same function. In the SQL editor, set yourself as the caller first so `auth.uid()` and `is_admin()` see you. Replace the two uuids. Read the `SELECT`s after it returns.

```sql
-- docs/program-staff.md — switch one person to program staff.
-- Does not run from applying migration 304. Idempotent.
-- Caller must be an admin if the person holds any program-scoped
-- schools.* grant other than schools.assignable_as_contact.

SELECT set_config('request.jwt.claim.sub', '<your admin user uuid>', true);

SELECT public.switch_person_to_program_staff(
  '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48',
  '<user uuid>'
);

SELECT 'staff' AS kind, id::text FROM public.program_staff
 WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48' AND user_id = '<user uuid>'
UNION ALL
SELECT 'leader', id::text FROM public.program_leaders
 WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48' AND user_id = '<user uuid>';

SELECT p.key, up.scope_type, up.scope_id
  FROM public.user_permissions up
  JOIN public.permissions p ON p.id = up.permission_id
 WHERE up.user_id = '<user uuid>'
   AND p.key LIKE 'schools.%';
```

## UI ownership

The Staff tab on the school page and the assigned-applicants screen for a staff-scoped viewer are included. Official accept / reject / waitlist stays on the existing applicants review, which staff cannot call.
