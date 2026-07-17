-- ============================================================
-- FFSA Hub — Migration 125: Program Leader permission bundle
-- ============================================================
-- The `program_leader` role has existed since 003 but carried NO
-- permissions — it only ever acted as a nav gate on the Training module
-- and granted nothing through the role engine (089). This gives it real
-- capabilities via role_permissions:
--
--   • schools.manage              — full Training management. Scope-aware,
--       so a program-scoped user_roles assignment (scope_type='program')
--       confines it to that program via has_schools_access(program_id).
--   • schools.assignable_as_contact — lets a Program Leader be listed as a
--       program's point-of-contact for applicants/students.
--
-- Granular schools sub-keys (manage_enrollments / view_applications /
-- approve_applications / manage_attendance) are strict subsets of
-- schools.manage and are intentionally omitted.
--
-- Purely additive (role engine 089); copies the idempotent bundle-seed
-- pattern from 115. No data backfill — the role is assigned per-user,
-- scoped to the program(s) a leader owns.
-- ============================================================

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p
  ON p.key IN ('schools.manage', 'schools.assignable_as_contact')
WHERE r.name = 'program_leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   -- bundle present (expect schools.assignable_as_contact, schools.manage)
--   SELECT p.key
--     FROM public.role_permissions rp
--     JOIN public.roles r       ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE r.name = 'program_leader'
--    ORDER BY p.key;
--
--   -- as a user holding program_leader scoped to program A only:
--   --   has_schools_access('<program A>') -> true
--   --   has_schools_access('<program B>') -> false
-- ============================================================
