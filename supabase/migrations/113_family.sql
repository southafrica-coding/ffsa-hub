-- ============================================================
-- FFSA Hub — Migration 113: Family (spouses, anniversaries, children)
-- ============================================================
-- Lets every user document their family from /profile and keeps the
-- shared facts in ONE place so two people never disagree:
--
--   partnerships — the couple. Holds the anniversary ONCE, plus a
--                  status lifecycle (engaged → married → …). partner_b
--                  is EITHER a linked Hub user (confirmation handshake)
--                  OR a free-text name for a spouse who has no account.
--   children     — attached to the COUPLE (partnership_id) once linked,
--                  so both partners see and edit the same kids with no
--                  duplicates; falls back to a single owner_user_id when
--                  there is no partnership yet.
--
-- Permissions (module = 'family'):
--   family.read   — pastoral / admin staff may VIEW any user's family
--   family.manage — staff may MANAGE family records on a user's behalf
--
-- Access model:
--   - A user always sees & manages their OWN family (partner / owner).
--   - The named partner can SEE a pending link and confirm it.
--   - is_admin() / has_permission() helpers already exist (002 / 015 / 089).
--   - handle_updated_at() trigger fn already exists (001).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0. Access helpers
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_family_manage()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin() OR public.has_permission('family.manage');
$$;

CREATE OR REPLACE FUNCTION public.has_family_read()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
      OR public.has_permission('family.read')
      OR public.has_permission('family.manage');
$$;

-- ────────────────────────────────────────────────────────────
-- 1. PARTNERSHIPS (the couple — single source of truth)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.partnerships (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_a_user_id   uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  partner_b_user_id   uuid REFERENCES public.users (id) ON DELETE SET NULL,
  partner_b_name      text,                       -- used when partner B has no Hub account
  anniversary_date    date,
  status              text NOT NULL DEFAULT 'married'
                      CHECK (status IN ('engaged', 'married', 'separated', 'divorced', 'widowed')),
  -- 'pending' only while a real Hub user must confirm; a non-user spouse
  -- is 'confirmed' on creation.
  confirmation_status text NOT NULL DEFAULT 'confirmed'
                      CHECK (confirmation_status IN ('pending', 'confirmed', 'declined')),
  confirmed_at        timestamptz,
  created_by          uuid REFERENCES public.users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- exactly one of: a linked Hub user OR a free-text non-user spouse name
  CONSTRAINT partnerships_partner_b_one_of CHECK (
    (partner_b_user_id IS NOT NULL AND partner_b_name IS NULL)
    OR (partner_b_user_id IS NULL AND partner_b_name IS NOT NULL)
  ),
  -- can't marry yourself
  CONSTRAINT partnerships_not_self CHECK (
    partner_b_user_id IS NULL OR partner_b_user_id <> partner_a_user_id
  )
);

CREATE INDEX idx_partnerships_partner_a ON public.partnerships (partner_a_user_id);
CREATE INDEX idx_partnerships_partner_b ON public.partnerships (partner_b_user_id);
CREATE INDEX idx_partnerships_pending_b ON public.partnerships (partner_b_user_id)
  WHERE confirmation_status = 'pending';

-- One active marriage per person (per side). Cross-side overlap is also
-- guarded in the service layer before insert/confirm. 'separated' still
-- counts as active; only 'divorced'/'widowed' free a person to re-link.
CREATE UNIQUE INDEX uniq_partnership_active_a ON public.partnerships (partner_a_user_id)
  WHERE confirmation_status = 'confirmed' AND status IN ('engaged', 'married', 'separated');
CREATE UNIQUE INDEX uniq_partnership_active_b ON public.partnerships (partner_b_user_id)
  WHERE partner_b_user_id IS NOT NULL
    AND confirmation_status = 'confirmed'
    AND status IN ('engaged', 'married', 'separated');

-- ────────────────────────────────────────────────────────────
-- 2. CHILDREN (attached to the couple, or to a lone owner)
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.children (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partnership_id uuid REFERENCES public.partnerships (id) ON DELETE SET NULL,
  owner_user_id  uuid REFERENCES public.users (id) ON DELETE CASCADE,
  full_name      text NOT NULL,
  birth_date     date,
  notes          text,
  created_by     uuid REFERENCES public.users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- a child must hang off the couple OR a single owner (never nothing)
  CONSTRAINT children_parent_required CHECK (
    partnership_id IS NOT NULL OR owner_user_id IS NOT NULL
  )
);

CREATE INDEX idx_children_partnership ON public.children (partnership_id);
CREATE INDEX idx_children_owner       ON public.children (owner_user_id);

-- ────────────────────────────────────────────────────────────
-- 3. updated_at triggers
-- ────────────────────────────────────────────────────────────

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.partnerships
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.children
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. PERMISSIONS (master list)
-- ────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('family', 'family.read',   'View family information',          10),
  ('family', 'family.manage', 'Manage family records (any user)', 20)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 5. ROW LEVEL SECURITY
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.partnerships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children     ENABLE ROW LEVEL SECURITY;

-- ── partnerships ────────────────────────────────────────────
-- Read: either partner, or pastoral/admin staff.
CREATE POLICY "partnerships_read" ON public.partnerships
  FOR SELECT TO authenticated
  USING (
    public.has_family_read()
    OR partner_a_user_id = auth.uid()
    OR partner_b_user_id = auth.uid()
  );

-- Insert: a user may only create a partnership where THEY are partner A
-- (the initiator); staff with family.manage may create on anyone's behalf.
CREATE POLICY "partnerships_insert" ON public.partnerships
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_family_manage()
    OR partner_a_user_id = auth.uid()
  );

-- Update: either partner (so partner B can confirm; either can edit the
-- anniversary / status) or staff.
CREATE POLICY "partnerships_update" ON public.partnerships
  FOR UPDATE TO authenticated
  USING (
    public.has_family_manage()
    OR partner_a_user_id = auth.uid()
    OR partner_b_user_id = auth.uid()
  )
  WITH CHECK (
    public.has_family_manage()
    OR partner_a_user_id = auth.uid()
    OR partner_b_user_id = auth.uid()
  );

CREATE POLICY "partnerships_delete" ON public.partnerships
  FOR DELETE TO authenticated
  USING (
    public.has_family_manage()
    OR partner_a_user_id = auth.uid()
    OR partner_b_user_id = auth.uid()
  );

-- ── children ────────────────────────────────────────────────
-- Read: the owner, either partner of the linked couple, or staff.
CREATE POLICY "children_read" ON public.children
  FOR SELECT TO authenticated
  USING (
    public.has_family_read()
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = children.partnership_id
        AND (p.partner_a_user_id = auth.uid() OR p.partner_b_user_id = auth.uid())
    )
  );

CREATE POLICY "children_insert" ON public.children
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_family_manage()
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = children.partnership_id
        AND (p.partner_a_user_id = auth.uid() OR p.partner_b_user_id = auth.uid())
    )
  );

CREATE POLICY "children_update" ON public.children
  FOR UPDATE TO authenticated
  USING (
    public.has_family_manage()
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = children.partnership_id
        AND (p.partner_a_user_id = auth.uid() OR p.partner_b_user_id = auth.uid())
    )
  )
  WITH CHECK (
    public.has_family_manage()
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = children.partnership_id
        AND (p.partner_a_user_id = auth.uid() OR p.partner_b_user_id = auth.uid())
    )
  );

CREATE POLICY "children_delete" ON public.children
  FOR DELETE TO authenticated
  USING (
    public.has_family_manage()
    OR owner_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.partnerships p
      WHERE p.id = children.partnership_id
        AND (p.partner_a_user_id = auth.uid() OR p.partner_b_user_id = auth.uid())
    )
  );

-- ============================================================
-- Validation (run in the Supabase SQL Editor after applying)
-- ------------------------------------------------------------
--   SELECT key, display_name FROM public.permissions WHERE module = 'family';
--   SELECT tablename, policyname, cmd FROM pg_policies
--     WHERE tablename IN ('partnerships','children') ORDER BY tablename, cmd;
--   \d+ public.partnerships
--   \d+ public.children
-- ============================================================
