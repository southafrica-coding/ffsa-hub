-- ============================================================
-- FFSA Hub — Migration 153: Household / family members
-- ------------------------------------------------------------
-- Staff used to record their family (spouse + children) on a paper
-- staff form: full name, passport, visa and health-insurance details.
-- The Hub only ever stored these for the account holder as flat columns
-- on public.users. This adds a per-user child table so each account
-- holder can list their family members — no separate logins.
--
-- The columns intentionally mirror the per-user passport / visa /
-- insurance columns on public.users so the same FieldConfig UI and
-- validation are reused. Household members are OPTIONAL and never feed
-- the profile-completion gate — they don't block the Hub.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Table
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.household_members (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                       uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  relationship                  text NOT NULL CHECK (relationship IN ('spouse', 'child', 'dependent')),
  full_name                     text NOT NULL,
  date_of_birth                 date,
  gender                        text,
  -- Passport
  passport_country              text,
  passport_number               text,
  passport_expiry_date          date,
  -- Visa (international members only)
  is_international              boolean NOT NULL DEFAULT false,
  visa_category                 text,
  visa_type                     text,
  visa_expiry_date              date,
  -- Health insurance
  health_insurance_provider     text,
  health_insurance_policy_number text,
  health_insurance_expiry_date  date,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS household_members_user_idx
  ON public.household_members (user_id);

-- Keep updated_at fresh on every write (shared handle_updated_at()
-- trigger fn, used across the schema).
DROP TRIGGER IF EXISTS trg_household_members_updated_at ON public.household_members;
CREATE TRIGGER trg_household_members_updated_at
  BEFORE UPDATE ON public.household_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. RLS — a user manages their own family records; admins may read
--    all (family data shows up alongside other profile data in the
--    admin user views).
-- ────────────────────────────────────────────────────────────
ALTER TABLE public.household_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own household members" ON public.household_members;
CREATE POLICY "Users read own household members"
  ON public.household_members FOR SELECT
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Users insert own household members" ON public.household_members;
CREATE POLICY "Users insert own household members"
  ON public.household_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own household members" ON public.household_members;
CREATE POLICY "Users update own household members"
  ON public.household_members FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users delete own household members" ON public.household_members;
CREATE POLICY "Users delete own household members"
  ON public.household_members FOR DELETE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins manage household members" ON public.household_members;
CREATE POLICY "Admins manage household members"
  ON public.household_members FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   INSERT INTO public.household_members (user_id, relationship, full_name)
--   VALUES ('<uuid>', 'child', 'Test Child');
--   SELECT * FROM public.household_members WHERE user_id = '<uuid>';
--   -- as another user, the row must NOT be visible (RLS).
-- ============================================================
