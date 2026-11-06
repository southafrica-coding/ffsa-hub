-- ============================================================
-- FFSA Hub — Migration 292: school / program leaders can request space bookings
-- ============================================================
-- Product rule (migration 191): everyone can SEE the space-bookings calendar;
-- leaders MAKE bookings. Ministry leaders and the Leadership Team got
-- bookings.request in migration 131, but school leaders were left off the
-- list: being named in program_leaders (migration 145) gives program-scoped
-- schools access and nothing else, so a school leader who is otherwise plain
-- staff (staff + self_service) can open Space Bookings but never book a room.
--
-- This is how school leaders get the same "request a space booking" access
-- ministry leaders already have. Offices 1-3 still auto-confirm when
-- venues.requires_approval is false (migration 097) — existing behaviour,
-- unchanged here.
--
-- WHY A NEW `school_leader` ROLE, NOT A BLANKET `program_leader` ROLE
-- ------------------------------------------------------------
-- An unscoped program_leader assignment is a GLOBAL schools manager:
--   • its bundle carries schools.manage (migration 125), and
--     has_permission_for('schools.manage', <any program>) is true for an
--     unscoped role (migration 089), so has_schools_access() opens every school;
--   • the app treats ANY program_leader role as all-programs access
--     (userCanManageApplications, schools-count-scopes).
-- Backfilling it to every row in program_leaders would let each school leader
-- manage every other school's applicants and records. So the membership-
-- derived marker is a new role that carries bookings.request and nothing
-- else — the same shape as leadership_team in migration 131.
--
--   1. school_leader role (is_system = false, like ministry_leader).
--   2. Bundles: school_leader -> bookings.request; and program_leader ->
--      bookings.request, so anyone already given that role by hand books too.
--   3. Backfill school_leader (global, unscoped, assigned_by NULL) for every
--      distinct user in program_leaders who lacks it.
--
-- Kept in sync afterwards by POST / DELETE /api/schools/programs/[id]/leaders,
-- the same way the ministries leaders API syncs ministry_leader: grant on add
-- if missing, revoke on remove only when they lead no other program.
--
-- Idempotent: ON CONFLICT DO NOTHING on roles / role_permissions, NOT EXISTS
-- on user_roles (NULL scope makes ON CONFLICT unreliable on its
-- (user_id, role_id, scope_type, scope_id) unique key). Safe to re-run.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. The role
-- ────────────────────────────────────────────────────────────
INSERT INTO public.roles (name, display_name, description, is_system)
VALUES (
  'school_leader',
  'School Leader',
  'Leads one or more schools. Given automatically from a school''s leader team; can request space bookings.',
  false
)
ON CONFLICT (name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Bundles -> bookings.request
-- ────────────────────────────────────────────────────────────
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
JOIN public.permissions p ON p.key = 'bookings.request'
WHERE r.name IN ('school_leader', 'program_leader')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Backfill: every current school leader holds school_leader
-- ────────────────────────────────────────────────────────────
INSERT INTO public.user_roles (user_id, role_id, assigned_by)
SELECT DISTINCT pl.user_id, r.id, NULL::uuid
FROM public.program_leaders pl
JOIN public.roles r ON r.name = 'school_leader'
WHERE NOT EXISTS (
  SELECT 1 FROM public.user_roles ur
  WHERE ur.user_id = pl.user_id
    AND ur.role_id = r.id
    AND ur.scope_type IS NULL
);

-- ============================================================
-- Verify (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   -- bundles (expect school_leader + program_leader both with bookings.request)
--   SELECT r.name, p.key
--     FROM public.role_permissions rp
--     JOIN public.roles r       ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE r.name IN ('school_leader', 'program_leader')
--    ORDER BY r.name, p.key;
--
--   -- every school leader holds the role (expect 0 rows)
--   SELECT DISTINCT pl.user_id
--     FROM public.program_leaders pl
--    WHERE NOT EXISTS (
--      SELECT 1 FROM public.user_roles ur
--        JOIN public.roles r ON r.id = ur.role_id AND r.name = 'school_leader'
--       WHERE ur.user_id = pl.user_id AND ur.scope_type IS NULL);
--
--   -- nobody gained a program_leader role from this migration
--   --   (compare against the count taken before applying)
--   SELECT count(*) FROM public.user_roles ur
--     JOIN public.roles r ON r.id = ur.role_id AND r.name = 'program_leader';
--
--   -- Tiónne Wiid (FFBX School Leader) — expect one row, scope_type NULL
--   SELECT r.name, ur.scope_type, ur.assigned_by
--     FROM public.user_roles ur
--     JOIN public.roles r ON r.id = ur.role_id
--    WHERE ur.user_id = 'f308a017-b23a-46ce-91fa-bc475a96833f'
--      AND r.name = 'school_leader';
-- ============================================================

-- ============================================================
-- ROLLBACK (run by hand only if needed)
-- ------------------------------------------------------------
--   BEGIN;
--   -- 3. backfilled + API-synced assignments
--   DELETE FROM public.user_roles ur
--    USING public.roles r
--    WHERE ur.role_id = r.id AND r.name = 'school_leader';
--   -- 2. bundles
--   DELETE FROM public.role_permissions rp
--    USING public.roles r, public.permissions p
--    WHERE rp.role_id = r.id AND rp.permission_id = p.id
--      AND r.name IN ('school_leader', 'program_leader')
--      AND p.key = 'bookings.request';
--   -- 1. the role
--   DELETE FROM public.roles WHERE name = 'school_leader';
--   COMMIT;
-- ============================================================
