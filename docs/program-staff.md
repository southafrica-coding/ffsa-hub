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
- read applications where `assigned_staff_id` is themselves (existing policy, plus the page only sends those rows when they have no broader grant)
- write one review per application on `application_staff_reviews`: `notes` and `interview_outcome` of `pending`, `recommend`, `hold`, or `decline`

`PUT /api/schools/applications/reviews`

```json
{ "response_id": "...", "notes": "Spoke on Tuesday.", "interview_outcome": "recommend" }
```

The write uses the signed-in user client. A trigger rejects it unless `auth.uid()` is program staff and the assigned contact. This does not change application status, send email, or enroll anyone. Leaders still decide status through the existing responses route.

They cannot:

- edit application questions, reference slots, reference questions, program email templates, email documents, or program settings (acceptance email included)
- read fee structures, student fees, payments, charge items, billing schedules, or billing plans for that school, except a fee row that is their own as a student

Leaders, `schools.*` holders, admins, and finance grants keep the access they already have. A person who is both a leader and staff is still a leader.

## SBI

Program `5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48`. Six people were given `schools.*` rows by hand, including `schools.assignable_as_contact`, and some may also be on Leaders. Leave them there until someone switches them. Until then their current access keeps working, and they stay assignable.

### Admin action

Someone who can manage that school (a leader, `schools.manage`, or an admin) calls:

`POST /api/schools/programs/5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48/staff/switch`

```json
{ "userId": "<the person>" }
```

The Leaders tab has the same action: “Move to staff”.

What it does, in order, and only for this program:

1. Inserts `program_staff` if missing.
2. Deletes that person’s `program_leaders` row for this program.
3. Revokes the `school_leader` role only when they lead no school at all.
4. Deletes `user_permissions` whose key starts with `schools.` and whose scope is this program.

It does not delete unscoped (global) permissions. It does not remove a `program_leader` role. An unscoped `program_leader` role is an all-schools manager; take that off by hand if it was granted. It refuses to switch a super admin. Running it twice is a no-op once they are already staff.

### Reviewed SQL

Same steps, for the SQL editor. Replace both uuids. Run one person at a time and read the `SELECT`s before the `COMMIT`.

```sql
-- docs/program-staff.md — switch one person to program staff.
-- Does not run from migration 304. Idempotent.
-- Keeps unscoped grants and every other program.

BEGIN;

-- SBI: '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'
-- person: '<user uuid>'

INSERT INTO public.program_staff (program_id, user_id)
VALUES ('5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48', '<user uuid>')
ON CONFLICT (program_id, user_id) DO NOTHING;

DELETE FROM public.program_leaders
 WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'
   AND user_id = '<user uuid>';

DELETE FROM public.user_roles ur
 USING public.roles r
 WHERE ur.role_id = r.id
   AND r.name = 'school_leader'
   AND ur.user_id = '<user uuid>'
   AND ur.scope_type IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.program_leaders pl WHERE pl.user_id = '<user uuid>'
   );

DELETE FROM public.user_permissions up
 USING public.permissions p
 WHERE up.permission_id = p.id
   AND up.user_id = '<user uuid>'
   AND up.scope_type = 'program'
   AND up.scope_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48'
   AND p.key LIKE 'schools.%';

-- Expect: one program_staff row, no program_leaders row for this school,
-- no program-scoped schools.* grants for this school.
SELECT 'staff' AS kind, id FROM public.program_staff
 WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48' AND user_id = '<user uuid>'
UNION ALL
SELECT 'leader', id FROM public.program_leaders
 WHERE program_id = '5ca7ccc0-ffec-4f9e-92ab-ad6bf99dfa48' AND user_id = '<user uuid>';

SELECT p.key, up.scope_type, up.scope_id
  FROM public.user_permissions up
  JOIN public.permissions p ON p.id = up.permission_id
 WHERE up.user_id = '<user uuid>'
   AND p.key LIKE 'schools.%';

COMMIT;
```

## UI ownership

The Staff tab on the school page and the assigned-applicants screen for a staff-scoped viewer are included. Official accept / reject / waitlist stays on the existing applicants review, which staff cannot call.
