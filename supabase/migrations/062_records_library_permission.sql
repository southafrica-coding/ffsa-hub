-- ============================================================
-- FFSA Hub — Migration 062: Records Library permission
-- ============================================================
-- Registers the records_library.manage permission so it can be
-- granted to staff via the existing Access section. super_admin
-- and admin already pass is_admin() checks; this permission lets
-- additional staff manage the Records Library without elevating
-- them to admin.
--
-- UPDATED BY MIGRATION 212: the general `admin` role is now carved out
-- of the Records Library, so this permission is also the only way to
-- give an admin access back. super_admin still passes on the role alone.
-- ============================================================

INSERT INTO public.permissions (module, key, display_name, sort_order)
VALUES
  ('records-library', 'records_library.manage', 'Manage Records Library', 10)
ON CONFLICT (key) DO NOTHING;
