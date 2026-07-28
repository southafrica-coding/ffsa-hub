-- ============================================================
-- FFSA Hub — Migration 137: Typed public signup links
-- ============================================================
-- Replaces the single org-wide signup code (075) with THREE
-- independent, typed links — staff / student / community.
--
-- The link someone signs up through now determines:
--   1. the access role they're granted (in addition to the
--      self_service floor) — see /api/public/signup,
--   2. the signup_type tag stored on their users row, and
--   3. which onboarding steps they see (community skips
--      passport/visa).
--
-- Changes:
--   1. signup_links       — one row per type, each with its own
--                           code + enabled flag. Superadmins copy /
--                           toggle / regenerate each from /users.
--   2. community_member    — new role (minimal access) + new
--                           person_type (CRM parity).
--   3. users.signup_type   — records which link a user came through.
--   4. Retire the old public_signup_settings singleton (disabled
--      so the previously-shared link stops creating untyped users).
--
-- Additive on the table side; one UPDATE to disable the old code.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. signup_links  (one row per type)
-- ------------------------------------------------------------
-- 'type' is the PK — exactly one row per link type. The active
-- 'code' is the segment that appears in /join/<code> URLs.
-- Regenerating swaps the code in place; the old link stops
-- working immediately. 'enabled' pauses a link without losing
-- its code.
--
-- staff ships DISABLED: the staff role can read the people
-- directory (PII), so a superadmin must deliberately enable that
-- link before sharing it.
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.signup_links (
  type            text PRIMARY KEY CHECK (type IN ('staff', 'student', 'community')),
  code            text NOT NULL UNIQUE,
  enabled         boolean NOT NULL DEFAULT true,
  regenerated_at  timestamptz NOT NULL DEFAULT now(),
  regenerated_by  uuid REFERENCES public.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.signup_links IS
  'Typed org-wide public signup links (staff/student/community). Used by /join/<code> for self-onboarding; the type drives role grant, signup_type tag, and onboarding steps.';

-- Seed one code per type. Same recipe as 075: a random 24-char
-- URL-safe string derived from gen_random_uuid().
INSERT INTO public.signup_links (type, code, enabled) VALUES
  ('staff',     substring(replace(gen_random_uuid()::text, '-', ''), 1, 24), false),
  ('student',   substring(replace(gen_random_uuid()::text, '-', ''), 1, 24), true),
  ('community', substring(replace(gen_random_uuid()::text, '-', ''), 1, 24), true);

ALTER TABLE public.signup_links ENABLE ROW LEVEL SECURITY;

-- Only super_admins read/write via a user session. Public code
-- validation + signup go through the service-role admin client,
-- which bypasses RLS (mirrors 075).
CREATE POLICY "super_admin reads signup links"
  ON public.signup_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

CREATE POLICY "super_admin writes signup links"
  ON public.signup_links
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid() AND r.name = 'super_admin'
    )
  );

-- ────────────────────────────────────────────────────────────
-- 2. community_member role + person_type
-- ------------------------------------------------------------
-- 'staff' and 'student' already exist as both a role (003) and a
-- person_type (003). 'community_member' is new. The role carries
-- no extra permissions of its own — every signup still gets the
-- self_service floor — it exists as a durable membership tag.
-- The person_type is seeded for CRM parity so admins can assign
-- it to contacts manually; signup does not auto-create contacts.
-- ────────────────────────────────────────────────────────────

INSERT INTO public.roles (name, display_name, description, is_system) VALUES
  ('community_member', 'Community Member', 'Community member. Minimal self-service access.', true)
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.person_types (name, description) VALUES
  ('community_member', 'Community member (no ongoing staff/student role)')
ON CONFLICT (name) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 3. users.signup_type
-- ------------------------------------------------------------
-- Records which link a user self-onboarded through. Nullable —
-- existing users and admin-invited users stay NULL.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS signup_type text
    CHECK (signup_type IN ('staff', 'student', 'community'));

COMMENT ON COLUMN public.users.signup_type IS
  'Which typed signup link the user self-onboarded through (staff/student/community), or NULL for invited/legacy users.';

-- ────────────────────────────────────────────────────────────
-- 4. Retire the old singleton signup code
-- ------------------------------------------------------------
-- Disable it so the previously-shared /join/<code> link can no
-- longer create untyped self_service accounts. The table is left
-- in place for now; a later migration can DROP it once nothing
-- references it.
-- ────────────────────────────────────────────────────────────

UPDATE public.public_signup_settings SET enabled = false WHERE id = 1;

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT type, enabled, length(code) FROM public.signup_links ORDER BY type;
--   -- expect 3 rows, each length 24; staff=false, student/community=true
--
--   SELECT name FROM public.roles WHERE name = 'community_member';
--   SELECT name FROM public.person_types WHERE name = 'community_member';
--   -- expect one row each
--
--   SELECT enabled FROM public.public_signup_settings WHERE id = 1;
--   -- expect: false
-- ============================================================
