-- ============================================================
-- FFSA Hub — Migration 329: Missio org Phase 0 data layer
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Previews share the production database, so do not run
-- this in the Supabase SQL editor until Lead says so.
--
-- Phase 0 is the wall between a Missio org and the FFSA directory.
-- Three new tables, two membership helpers, one extra SELECT policy
-- on contacts, and a label mirror. No backfill: the contacts that
-- already carry the 'missio' label stay where they are until a
-- separate, Jack-approved step copies them into org_people.
--
-- HARD WALL. is_admin() and super_admin do not appear in any policy
-- on organisations, org_staff_roles, or org_people, and the two
-- helpers do not consult FFSA roles. An FFSA admin with no Missio
-- org_staff_roles row sees none of these rows and cannot write them.
-- Grants of org roles are service-role only (no INSERT/UPDATE/DELETE
-- policy on org_staff_roles). Organisation rows are readable by any
-- signed-in user and writable only by the service role.
--
-- Operator rules, enforced by the absence of policies rather than by
-- the app:
--   1. Do not give a Missio pastor (or any other Missio role) the
--      FFSA 'staff' role or contacts.view / contacts.read. Those
--      policies are table-wide and would show every contact.
--   2. Insert org_staff_roles with the service role only.
--   3. Do not backfill org_people from the existing missio label
--      in this migration.
--
-- contacts keeps every existing policy. The one new SELECT policy
-- reaches a contact only through an org_people row in an org where
-- the caller holds some org_staff_roles row. No new INSERT, UPDATE,
-- or DELETE on contacts. contact_emails, contact_phones, labels, and
-- contact_labels are untouched. labels and contact_labels stay
-- readable by any signed-in user — that is the pre-existing policy
-- from 042, which later permission work did not narrow. This file
-- does not widen it.
--
-- Idempotent: CREATE IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY
-- IF EXISTS, INSERT ... ON CONFLICT DO NOTHING.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. organisations
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organisations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  name             text NOT NULL,
  contact_label_id uuid REFERENCES public.labels (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organisations IS
  'Org wall for Phase 0. FFSA and Missio are rows here. Membership is org_staff_roles / org_people, not an FFSA user_roles row.';

COMMENT ON COLUMN public.organisations.contact_label_id IS
  'Label mirrored onto a contact while an org_people row exists. Looked up by labels.slug at seed time. Null means this org does not tag contacts.';

-- The missio label id is resolved by slug. Never hard-code it.
-- ON CONFLICT DO NOTHING: a re-run will not fill contact_label_id
-- if this insert first landed while the label was missing.
INSERT INTO public.organisations (slug, name, contact_label_id)
VALUES
  ('ffsa', 'Fire & Fragrance South Africa', NULL),
  ('missio', 'Missio', (SELECT id FROM public.labels WHERE slug = 'missio'))
ON CONFLICT (slug) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. org_staff_roles
--    No seed. A row is a grant, and grants are service-role only.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_staff_roles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN (
               'pastor', 'admin', 'house_church_leader', 'team_leader', 'finance'
             )),
  -- Null campus means every campus of this org.
  campus     text CHECK (campus IS NULL OR campus IN ('potch', 'jhb')),
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, role)
);

CREATE INDEX IF NOT EXISTS org_staff_roles_user_org_idx
  ON public.org_staff_roles (user_id, org_id);

COMMENT ON TABLE public.org_staff_roles IS
  'Who holds a Missio (or other org) role. Not an FFSA user_roles row. Inserts are service-role only: there is no write policy.';

COMMENT ON COLUMN public.org_staff_roles.campus IS
  'potch or jhb. NULL means the grant covers every campus.';

-- ────────────────────────────────────────────────────────────
-- 3. org_people
--    No backfill of contacts that already have the missio label.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.org_people (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  contact_id    uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  campus        text NOT NULL DEFAULT 'potch' CHECK (campus IN ('potch', 'jhb')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('visitor', 'active', 'inactive')),
  joined_at     date,
  current_stage text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contact_id)
);

CREATE INDEX IF NOT EXISTS org_people_contact_id_idx
  ON public.org_people (contact_id);

COMMENT ON TABLE public.org_people IS
  'A contact inside one org. This is the only path an org role has to a contact. Not backfilled from existing labels.';

DROP TRIGGER IF EXISTS set_updated_at ON public.org_people;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.org_people
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 4. Helpers
--    True only when org_staff_roles has a row for auth.uid() in
--    that org. FFSA is_admin() / super_admin is not consulted.
--    SECURITY DEFINER so the check does not recurse through the
--    org_staff_roles SELECT policy. search_path is empty and every
--    name is qualified. auth.uid() is wrapped in a scalar subquery
--    so the planner evaluates it once per statement.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.has_org_role_id(
  p_org_id uuid,
  p_roles text[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_staff_roles r
    WHERE r.user_id = (SELECT auth.uid())
      AND r.org_id = p_org_id
      AND (p_roles IS NULL OR r.role = ANY (p_roles))
  );
$$;

CREATE OR REPLACE FUNCTION public.has_org_role(
  p_org_slug text,
  p_roles text[] DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_staff_roles r
    JOIN public.organisations o ON o.id = r.org_id
    WHERE r.user_id = (SELECT auth.uid())
      AND o.slug = p_org_slug
      AND (p_roles IS NULL OR r.role = ANY (p_roles))
  );
$$;

REVOKE ALL ON FUNCTION public.has_org_role_id(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_org_role(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_org_role_id(uuid, text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_org_role(text, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_org_role_id(uuid, text[]) IS
  'True when the caller has an org_staff_roles row in p_org_id. p_roles null means any role. Does not treat FFSA admin or super_admin as a member.';

COMMENT ON FUNCTION public.has_org_role(text, text[]) IS
  'has_org_role_id looked up by organisations.slug.';

-- ────────────────────────────────────────────────────────────
-- 5. RLS
--    Supabase default privileges grant new public tables to
--    anon and authenticated. Revoke anon (and PUBLIC), then
--    grant authenticated only the commands a policy allows.
--    service_role keeps ALL and bypasses RLS, which is how
--    org_staff_roles grants and organisation edits are made.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_people ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organisations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.org_staff_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.org_people FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.organisations TO authenticated;
GRANT SELECT ON TABLE public.org_staff_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.org_people TO authenticated;

GRANT ALL ON TABLE public.organisations TO service_role;
GRANT ALL ON TABLE public.org_staff_roles TO service_role;
GRANT ALL ON TABLE public.org_people TO service_role;

-- organisations: read for any signed-in user. No write policy.
DROP POLICY IF EXISTS "Authenticated can read organisations" ON public.organisations;
CREATE POLICY "Authenticated can read organisations"
  ON public.organisations
  FOR SELECT
  TO authenticated
  USING (true);

-- org_staff_roles: own row, or every row in an org you pastor or admin.
-- No INSERT / UPDATE / DELETE policy.
DROP POLICY IF EXISTS "Users can read their own org staff roles" ON public.org_staff_roles;
CREATE POLICY "Users can read their own org staff roles"
  ON public.org_staff_roles
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Org pastors and admins can read org staff roles" ON public.org_staff_roles;
CREATE POLICY "Org pastors and admins can read org staff roles"
  ON public.org_staff_roles
  FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor', 'admin']));

-- org_people: any org role can read. pastor and org admin can insert
-- and update. No DELETE policy for anyone, including FFSA admins.
DROP POLICY IF EXISTS "Org staff can read org people" ON public.org_people;
CREATE POLICY "Org staff can read org people"
  ON public.org_people
  FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id));

DROP POLICY IF EXISTS "Org pastors and admins can insert org people" ON public.org_people;
CREATE POLICY "Org pastors and admins can insert org people"
  ON public.org_people
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor', 'admin']));

DROP POLICY IF EXISTS "Org pastors and admins can update org people" ON public.org_people;
CREATE POLICY "Org pastors and admins can update org people"
  ON public.org_people
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor', 'admin']))
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor', 'admin']));

-- contacts: one new SELECT. Existing policies are not replaced.
-- A Missio role reaches a contact only when org_people links them
-- and has_org_role_id is true for that org. is_admin() is not a branch.
DROP POLICY IF EXISTS "Org staff can read their org's people" ON public.contacts;
CREATE POLICY "Org staff can read their org's people"
  ON public.contacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.org_people op
      WHERE op.contact_id = contacts.id
        AND public.has_org_role_id(op.org_id)
    )
  );

-- ────────────────────────────────────────────────────────────
-- 6. Label mirror
--    While an org_people row exists, the org's contact label is
--    present on that contact with added_via = 'org_people_sync'.
--    Removing the last such row removes only that synced label.
--    A label added any other way (added_via <> 'org_people_sync')
--    is left in place. contact_labels' primary key is
--    (contact_id, label_id), so a second insert is a no-op and
--    does not overwrite a manual row.
--
--    The function is SECURITY DEFINER with an empty search_path
--    so a pastor, who cannot write contact_labels, still gets the
--    mirror. It does not grant that write to the caller.
--
--    Migration 046 records an unsubscribe when a contact_labels
--    row is deleted, but that trigger returns immediately when
--    pg_trigger_depth() > 1. This delete runs inside the
--    org_people trigger, so it does not write an unsubscribes row.
--    Taking someone off the org is not an email opt-out.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_org_people_contact_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_label uuid;
BEGIN
  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT o.contact_label_id
      INTO v_label
      FROM public.organisations o
     WHERE o.id = NEW.org_id;

    IF v_label IS NOT NULL THEN
      INSERT INTO public.contact_labels (contact_id, label_id, added_via, added_by)
      VALUES (NEW.contact_id, v_label, 'org_people_sync', (SELECT auth.uid()))
      ON CONFLICT (contact_id, label_id) DO NOTHING;
    END IF;
  END IF;

  IF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND (
           OLD.org_id IS DISTINCT FROM NEW.org_id
           OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
         )) THEN
    SELECT o.contact_label_id
      INTO v_label
      FROM public.organisations o
     WHERE o.id = OLD.org_id;

    IF v_label IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
           FROM public.org_people op
          WHERE op.contact_id = OLD.contact_id
            AND op.org_id = OLD.org_id
       ) THEN
      DELETE FROM public.contact_labels
       WHERE contact_id = OLD.contact_id
         AND label_id = v_label
         AND added_via = 'org_people_sync';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_org_people_contact_label() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_org_people_contact_label() TO authenticated, service_role;

COMMENT ON FUNCTION public.sync_org_people_contact_label() IS
  'Mirrors organisations.contact_label_id onto contact_labels while an org_people row exists. Deletes only rows it added (added_via = org_people_sync), and only when no other org_people row still links that contact to that org.';

DROP TRIGGER IF EXISTS trg_org_people_sync_contact_label ON public.org_people;
CREATE TRIGGER trg_org_people_sync_contact_label
  AFTER INSERT OR DELETE OR UPDATE OF org_id, contact_id
  ON public.org_people
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_org_people_contact_label();
