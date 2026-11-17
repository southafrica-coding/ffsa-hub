-- ============================================================
-- FFSA Hub — Migration 329: Missio org Phase 0 data layer
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Previews share the production database, so do not run
-- this in the Supabase SQL editor until Lead says so.
--
-- Phase 0 is the wall between a Missio org and the FFSA directory.
-- Three new tables, two membership helpers, a names-only directory
-- view, and a label mirror. No new policy on contacts. No backfill:
-- the contacts that already carry the 'missio' label stay where they
-- are until a separate, Jack-approved step copies them into org_people.
--
-- HARD WALL. is_admin() and super_admin do not appear in any policy
-- on organisations, org_staff_roles, or org_people, and the two
-- helpers do not consult FFSA roles. An FFSA admin with no Missio
-- org_staff_roles row sees none of these rows and cannot write them.
-- Grants of org roles are service-role only (no INSERT/UPDATE/DELETE
-- policy on org_staff_roles). Organisation rows are readable by any
-- signed-in user and writable only by the service role.
-- org_people inserts are service-role only. contact_labels is
-- readable by any signed-in user (042), so a Missio pastor can see
-- every contact_id. An INSERT or an update of contact_id / org_id
-- would attach that FFSA contact. There is no contacts policy for
-- org roles: a Missio role reads names only, through
-- org_people_directory. authenticated's table-wide SELECT on
-- contacts would otherwise return notes, DOB, address, email and
-- phone, and v_contact_summary / v_campaign_audience run as the
-- caller (166) so they would too.
--
-- campus on org_staff_roles is informational in Phase 0. Scoping is
-- not enforced: a role with campus potch or jhb currently sees the
-- whole org. Enforcing it is Phase 1.
--
-- Authenticated may UPDATE only campus, status, joined_at and
-- current_stage (column privileges, not just the RLS policy).
-- org_id, contact_id, id and created_by are not grantable.
-- updated_at is not grantable either; handle_updated_at() sets it
-- inside the BEFORE UPDATE trigger, which does not need the caller
-- to hold UPDATE on that column.
--
-- Operator rules, enforced by the absence of policies and grants
-- rather than by the app:
--   1. Do not give a Missio pastor (or any other Missio role) the
--      FFSA 'staff' role or contacts.view / contacts.read. Those
--      policies are table-wide and would show every contact.
--   2. Insert org_staff_roles with the service role only.
--   3. org_people inserts are service-role only, after Hub Backend's
--      own check and match. Do not grant authenticated INSERT.
--   4. Do not backfill org_people from the existing missio label
--      in this migration.
--
-- contacts keeps every existing policy and gains none. No new
-- INSERT, UPDATE, or DELETE on contacts. contact_emails,
-- contact_phones, labels, and contact_labels are untouched. labels
-- and contact_labels stay readable by any signed-in user — that is
-- the pre-existing policy
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
  -- Informational in Phase 0. Not enforced; see the column comment.
  campus     text CHECK (campus IS NULL OR campus IN ('potch', 'jhb')),
  granted_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id, role)
);

CREATE INDEX IF NOT EXISTS org_staff_roles_user_org_idx
  ON public.org_staff_roles (user_id, org_id);

COMMENT ON TABLE public.org_staff_roles IS
  'Who holds a Missio (or other org) role. Not an FFSA user_roles row. Inserts are service-role only: there is no write policy.';

COMMENT ON COLUMN public.org_staff_roles.campus IS
  'potch, jhb, or NULL. Informational in Phase 0: campus scoping is not enforced, so a campus-scoped role currently sees the whole org. Enforcement is Phase 1.';

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
  created_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contact_id)
);

CREATE INDEX IF NOT EXISTS org_people_contact_id_idx
  ON public.org_people (contact_id);

COMMENT ON TABLE public.org_people IS
  'A contact inside one org. Inserts are service-role only. Authenticated pastors and org admins may update campus, status, joined_at and current_stage. Not backfilled from existing labels.';

-- CREATE TABLE IF NOT EXISTS does not add constraints to a table
-- that already exists. These two FKs are part of the table above;
-- the block covers a re-run against that earlier shape.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_staff_roles_granted_by_fkey'
  ) THEN
    ALTER TABLE public.org_staff_roles
      ADD CONSTRAINT org_staff_roles_granted_by_fkey
      FOREIGN KEY (granted_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_people_created_by_fkey'
  ) THEN
    ALTER TABLE public.org_people
      ADD CONSTRAINT org_people_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE SET NULL;
  END IF;
END $$;

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
--    org_staff_roles grants, organisation edits, and org_people
--    inserts are made.
--
--    org_people has no INSERT grant for authenticated. UPDATE is
--    column-level: campus, status, joined_at, current_stage.
--    REVOKE ALL on a table removes table privileges and column
--    grants, so the GRANTs below are the whole authenticated set
--    on every run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.organisations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_staff_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_people ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.organisations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.org_staff_roles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.org_people FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.organisations TO authenticated;
GRANT SELECT ON TABLE public.org_staff_roles TO authenticated;
GRANT SELECT ON TABLE public.org_people TO authenticated;
GRANT UPDATE (campus, status, joined_at, current_stage)
  ON TABLE public.org_people TO authenticated;

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

-- org_people: any org role can read. pastor and org admin can update
-- the person fields the column grants allow. No INSERT policy and
-- no DELETE policy. New rows are service-role only.
DROP POLICY IF EXISTS "Org staff can read org people" ON public.org_people;
CREATE POLICY "Org staff can read org people"
  ON public.org_people
  FOR SELECT
  TO authenticated
  USING (public.has_org_role_id(org_id));

DROP POLICY IF EXISTS "Org pastors and admins can insert org people" ON public.org_people;

DROP POLICY IF EXISTS "Org pastors and admins can update org people" ON public.org_people;
CREATE POLICY "Org pastors and admins can update org people"
  ON public.org_people
  FOR UPDATE
  TO authenticated
  USING (public.has_org_role_id(org_id, ARRAY['pastor', 'admin']))
  WITH CHECK (public.has_org_role_id(org_id, ARRAY['pastor', 'admin']));

-- contacts: no new policy. Drop the one this file used to add, so a
-- re-run removes it. authenticated already has table-wide SELECT;
-- a policy here would return the whole contact row (notes, DOB,
-- address, email, phone) to every Missio role. Names are the view
-- below, and nothing else.
DROP POLICY IF EXISTS "Org staff can read their org's people" ON public.contacts;

-- ────────────────────────────────────────────────────────────
-- 5b. org_people_directory
--     Owner rights (security_invoker = false) so the view can read
--     contacts the caller cannot. security_barrier so a caller's
--     WHERE cannot see rows has_org_role_id rejects. The column
--     list is the whole contract: names only.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.org_people_directory
WITH (security_invoker = false, security_barrier = true) AS
SELECT
  op.id,
  op.org_id,
  op.contact_id,
  op.campus,
  op.status,
  op.joined_at,
  op.current_stage,
  op.created_at,
  op.updated_at,
  c.first_name,
  c.last_name,
  c.preferred_name
FROM public.org_people op
JOIN public.contacts c ON c.id = op.contact_id
WHERE public.has_org_role_id(op.org_id);

ALTER VIEW public.org_people_directory SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.org_people_directory OWNER TO postgres;

REVOKE ALL ON TABLE public.org_people_directory FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.org_people_directory TO authenticated, service_role;

COMMENT ON VIEW public.org_people_directory IS
  'The only way an org role reads a contact name. Columns are the org_people fields plus first_name, last_name and preferred_name. Names only are intentional: email, phone, notes, address and the rest of the contact row are not here. Runs as the owner, then keeps rows where has_org_role_id(org_id) is true.';

-- ────────────────────────────────────────────────────────────
-- 6. Label mirror
--    While an org_people row exists, the org's contact label is
--    present on that contact with added_via = 'org_people_sync'.
--    Removing the last such row removes only that synced label.
--    A label added any other way (added_via <> 'org_people_sync')
--    is left in place. contact_labels' primary key is
--    (contact_id, label_id). ON CONFLICT DO NOTHING does not
--    change added_via. Accepted for Phase 0: if staff later re-add
--    that same label by hand while the sync row still exists, it
--    keeps added_via = 'org_people_sync' and is still removed when
--    the person leaves the org. A label that was manual before any
--    sync row existed is not overwritten and is not removed.
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

COMMENT ON FUNCTION public.sync_org_people_contact_label() IS
  'Mirrors organisations.contact_label_id onto contact_labels while an org_people row exists. Deletes only rows it added (added_via = org_people_sync), and only when no other org_people row still links that contact to that org. ON CONFLICT DO NOTHING leaves added_via alone, so a hand re-add of a synced label keeps org_people_sync and is still removed when the person leaves. Accepted for Phase 0.';

DROP TRIGGER IF EXISTS trg_org_people_sync_contact_label ON public.org_people;
CREATE TRIGGER trg_org_people_sync_contact_label
  AFTER INSERT OR DELETE OR UPDATE OF org_id, contact_id
  ON public.org_people
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_org_people_contact_label();
