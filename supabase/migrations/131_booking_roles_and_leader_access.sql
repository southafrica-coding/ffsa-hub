-- ============================================================
-- FFSA Hub — Migration 131: Booking roles + leader / Leadership-Team booking access
-- ============================================================
-- Three new roles (is_system = false, so they surface in the Roles admin page
-- and the "Add title" picker):
--   • vehicle_manager  — manages vehicle bookings (view / approve / manage)
--   • booking_manager  — manages SPACE bookings (view / approve / manage)
--   • leadership_team  — Leadership Team membership marker; carries space-
--                        booking-REQUEST access. Auto-synced to active members
--                        of the 'leadership_team' staff ministry by the trigger
--                        below (mirrors how ministry_leader is synced to
--                        ministry leaders in the /api/ministries API routes),
--                        so FUTURE Leadership Team members get booking access
--                        automatically — including plain members, and adds made
--                        via SQL rather than the UI.
--
-- Also: Ministry Leaders (incl. Point Leaders, who are always leaders) get
-- bookings.request via the ministry_leader bundle.
--
-- Floor reminder (migration 115): every user already carries self_service ->
-- bookings.view + vehicles.view + vehicles.request. So calendar viewing and
-- vehicle requests are already universal; the only gap this migration fills for
-- booking is bookings.request (CREATING a space booking). Office 1-3 already
-- have venues.requires_approval = false (migration 097), so those bookings
-- auto-confirm instantly when the slot is open.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Roles
-- ────────────────────────────────────────────────────────────
INSERT INTO public.roles (name, display_name, description, is_system) VALUES
  ('vehicle_manager', 'Vehicle Manager',
   'Manages vehicle bookings: view, approve/deny, and manage vehicles & settings.', false),
  ('booking_manager', 'Space Booking Manager',
   'Manages space bookings: view, approve/deny, and manage venues & settings.', false),
  ('leadership_team', 'Leadership Team',
   'Leadership Team member. Auto-assigned from Leadership Team ministry membership; can request space bookings.', false)
ON CONFLICT (name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. Role bundles
-- ────────────────────────────────────────────────────────────
-- Vehicle Manager
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON p.key IN ('vehicles.view','vehicles.approve','vehicles.manage')
WHERE r.name = 'vehicle_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Space Booking Manager
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON p.key IN ('bookings.view','bookings.approve','bookings.manage')
WHERE r.name = 'booking_manager'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Leadership Team -> can request space bookings
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON p.key = 'bookings.request'
WHERE r.name = 'leadership_team'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Ministry Leaders (incl. Point Leaders) -> can request space bookings
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r
JOIN public.permissions p ON p.key = 'bookings.request'
WHERE r.name = 'ministry_leader'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. Auto-sync the leadership_team role with Leadership Team membership.
--    Membership-derived role, so add/remove wholesale is safe. SECURITY
--    DEFINER + fixed search_path, matching leads_staff_ministry (126).
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_leadership_team_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  lt_id       uuid;
  lt_role_id  uuid;
  uid         uuid;
BEGIN
  SELECT id INTO lt_id      FROM public.staff_ministries WHERE slug = 'leadership_team';
  SELECT id INTO lt_role_id FROM public.roles            WHERE name = 'leadership_team';
  IF lt_id IS NULL OR lt_role_id IS NULL THEN
    RETURN NULL;
  END IF;

  uid := COALESCE(NEW.user_id, OLD.user_id);

  IF EXISTS (
    SELECT 1 FROM public.staff_ministry_members
    WHERE user_id = uid AND staff_ministry_id = lt_id AND status = 'active'
  ) THEN
    -- Active Leadership Team member -> ensure they hold the role (global scope).
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = uid AND role_id = lt_role_id AND scope_type IS NULL
    ) THEN
      INSERT INTO public.user_roles (user_id, role_id) VALUES (uid, lt_role_id);
    END IF;
  ELSE
    -- No longer an active Leadership Team member -> remove the role.
    DELETE FROM public.user_roles
    WHERE user_id = uid AND role_id = lt_role_id AND scope_type IS NULL;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS staff_ministry_members_leadership_role ON public.staff_ministry_members;
CREATE TRIGGER staff_ministry_members_leadership_role
  AFTER INSERT OR UPDATE OR DELETE ON public.staff_ministry_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_leadership_team_role();

-- ────────────────────────────────────────────────────────────
-- 4. Backfills (NOT EXISTS guard — NULL scope makes ON CONFLICT unreliable
--    on the user_roles (user_id, role_id, scope_type, scope_id) unique key).
-- ────────────────────────────────────────────────────────────
-- 4a. Assign leadership_team role to current active Leadership Team members.
INSERT INTO public.user_roles (user_id, role_id)
SELECT DISTINCT mm.user_id, r.id
FROM public.staff_ministry_members mm
JOIN public.staff_ministries sm ON sm.id = mm.staff_ministry_id AND sm.slug = 'leadership_team'
JOIN public.roles r ON r.name = 'leadership_team'
WHERE mm.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = mm.user_id AND ur.role_id = r.id AND ur.scope_type IS NULL
  );

-- 4b. Ensure every active ministry leader holds the ministry_leader role.
INSERT INTO public.user_roles (user_id, role_id)
SELECT DISTINCT mm.user_id, r.id
FROM public.staff_ministry_members mm
JOIN public.roles r ON r.name = 'ministry_leader'
WHERE mm.member_role = 'leader' AND mm.status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = mm.user_id AND ur.role_id = r.id AND ur.scope_type IS NULL
  );

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   -- Bundles present for the new + updated roles:
--   SELECT r.name, p.key FROM public.role_permissions rp
--     JOIN public.roles r       ON r.id = rp.role_id
--     JOIN public.permissions p ON p.id = rp.permission_id
--    WHERE r.name IN ('vehicle_manager','booking_manager','leadership_team','ministry_leader')
--    ORDER BY r.name, p.key;
--
--   -- Leadership Team members now hold the role:
--   SELECT u.email FROM public.user_roles ur
--     JOIN public.roles r ON r.id = ur.role_id AND r.name = 'leadership_team'
--     JOIN public.users u ON u.id = ur.user_id;
-- ============================================================
