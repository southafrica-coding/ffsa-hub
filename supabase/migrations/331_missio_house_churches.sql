-- ============================================================
-- FFSA Hub — Migration 331: Missio house churches
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Depends on migration 329 (organisations, contacts,
-- users, has_org_role, handle_updated_at).
--
-- House churches are inside the Missio wall. Every policy calls
-- (SELECT public.has_org_role('missio', ARRAY['pastor'])) and
-- checks the row belongs to the missio organisation. is_admin(),
-- has_role(), has_any_role() and contacts permissions are not
-- consulted. An FFSA admin or super_admin with no Missio pastor
-- row sees nothing here and cannot write it. A Missio org admin
-- who is not a pastor sees nothing here either.
--
-- Decisions (Jack):
--   * 20 house churches, all on the Potch campus.
--   * The sheet's "Leader 2" is the co_leader role.
--   * A person may belong to more than one house church.
--   * A Missio member is anyone with at least one current
--     house-church membership. Current means the row is open
--     (ended_at is null) and started_at is on or before today.
--     ended_at in the future is rejected. A CHECK cannot call
--     current_date (it is not immutable), so a BEFORE trigger
--     raises 23514. The partial unique index is the same open
--     row: ended_at IS NULL.
--
-- org_people rows are ensured by service-role API code when
-- someone is added to a house. That sync is one-way and has no
-- trigger in this migration. Leaving a house never changes
-- org_people. org_people.status is NOT auto-synced here.
--
-- missio_import_review is staging for a later service-role
-- import. This file seeds no people and no names. source_line
-- is required and unique with raw_name per org, so one sheet
-- line can split into several names and the import can upsert
-- idempotently. Authenticated pastors may resolve a row
-- (status, resolved_contact_id, notes, resolved_by,
-- resolved_at). They may not insert or delete one.
--
-- Idempotent: CREATE IF NOT EXISTS, CREATE OR REPLACE, DROP
-- POLICY IF EXISTS, INSERT ... ON CONFLICT DO NOTHING.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. house_churches
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.house_churches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  number        int NOT NULL CHECK (number > 0),
  name          text,
  campus        text NOT NULL DEFAULT 'potch' CHECK (campus IN ('potch', 'jhb')),
  meeting_day   text CHECK (
                  meeting_day IS NULL
                  OR meeting_day IN (
                    'monday', 'tuesday', 'wednesday', 'thursday',
                    'friday', 'saturday', 'sunday'
                  )
                ),
  location      text,
  leader_notes  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

COMMENT ON TABLE public.house_churches IS
  'Missio house church. Pastors only. Seeded 1..20 on campus potch. No personal data.';

COMMENT ON COLUMN public.house_churches.number IS
  'Stable house number within the org. Unique per org. The sheet uses these numbers.';

COMMENT ON COLUMN public.house_churches.campus IS
  'potch or jhb, same check as organisations-era campus columns in migration 329. Default potch.';

DROP TRIGGER IF EXISTS set_updated_at ON public.house_churches;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.house_churches
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. house_church_members
--    One open row (ended_at IS NULL) per person per house.
--    Historical rows can repeat. A person may be open in
--    more than one house at the same time.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.house_church_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_church_id uuid NOT NULL REFERENCES public.house_churches (id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES public.contacts (id) ON DELETE RESTRICT,
  role            text NOT NULL CHECK (role IN ('leader', 'co_leader', 'member')),
  started_at      date NOT NULL DEFAULT current_date,
  ended_at        date CHECK (ended_at IS NULL OR ended_at >= started_at),
  created_by      uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS house_church_members_active_house_contact_uidx
  ON public.house_church_members (house_church_id, contact_id)
  WHERE ended_at IS NULL;

CREATE INDEX IF NOT EXISTS house_church_members_contact_id_idx
  ON public.house_church_members (contact_id);

CREATE INDEX IF NOT EXISTS house_church_members_house_church_id_idx
  ON public.house_church_members (house_church_id);

COMMENT ON TABLE public.house_church_members IS
  'Membership of a contact in a house church. role co_leader is the sheet''s Leader 2. The partial unique index allows one open row (ended_at IS NULL) per person per house, and allows a new open row after the previous one is ended. It does not write org_people.';

COMMENT ON COLUMN public.house_church_members.role IS
  'leader, co_leader, or member. co_leader is what the import sheet calls Leader 2.';

COMMENT ON COLUMN public.house_church_members.ended_at IS
  'Null while the row is the open, current membership. A date on or before today has ended and is not current. A date after today raises 23514 missio_ended_at_in_future. current_date is not immutable, so this is a trigger rather than a CHECK. The partial unique index uses the same open predicate, ended_at IS NULL. Nothing in this migration blocks DELETE.';

DROP TRIGGER IF EXISTS set_updated_at ON public.house_church_members;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.house_church_members
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Applies to every role, including service_role, which bypasses RLS.
-- Does not run on DELETE: the service role may hard-delete a row.
-- current_date is not immutable, so the future-end rule cannot be a CHECK.
CREATE OR REPLACE FUNCTION public.guard_house_church_member()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
BEGIN
  IF NEW.started_at > current_date THEN
    RAISE EXCEPTION 'missio_started_at_in_future'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.ended_at IS NOT NULL AND NEW.ended_at > current_date THEN
    RAISE EXCEPTION 'missio_ended_at_in_future'
      USING ERRCODE = '23514';
  END IF;

  -- Re-check org_people only when the person or the house changes.
  -- Ending a membership, or changing its role, still works after the
  -- org_people row has been removed.
  IF TG_OP = 'INSERT'
     OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
     OR NEW.house_church_id IS DISTINCT FROM OLD.house_church_id
  THEN
    SELECT hc.org_id INTO v_org
    FROM public.house_churches hc
    WHERE hc.id = NEW.house_church_id;

    IF v_org IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.org_people op
      WHERE op.org_id = v_org
        AND op.contact_id = NEW.contact_id
    ) THEN
      RAISE EXCEPTION 'missio_member_not_in_org'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    NEW.created_by := auth.uid();
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_house_church_member() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_house_church_member() IS
  'BEFORE INSERT OR UPDATE, every role. 23503 missio_member_not_in_org when an insert, or an update that changes contact_id or house_church_id, has no org_people row for the house org. Ending a membership or changing its role does not re-check org_people. 23514 missio_started_at_in_future when started_at is after today. 23514 missio_ended_at_in_future when ended_at is after today. Pins created_by to auth.uid() when that is set; a null auth.uid() keeps the supplied value. Does not run on DELETE.';

DROP TRIGGER IF EXISTS trg_house_church_member_end_not_future ON public.house_church_members;
DROP TRIGGER IF EXISTS trg_house_church_member_pin_created_by ON public.house_church_members;
DROP FUNCTION IF EXISTS public.reject_future_house_membership_end();
DROP FUNCTION IF EXISTS public.pin_house_church_member_created_by();

DROP TRIGGER IF EXISTS trg_house_church_member_guard ON public.house_church_members;
CREATE TRIGGER trg_house_church_member_guard
  BEFORE INSERT OR UPDATE OF contact_id, house_church_id, started_at, ended_at, created_by
  ON public.house_church_members
  FOR EACH ROW EXECUTE FUNCTION public.guard_house_church_member();

-- ────────────────────────────────────────────────────────────
-- 3. missio_import_review
--    No seed. The import runs later as the service role.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.missio_import_review (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  source_line            int NOT NULL,
  raw_name               text NOT NULL,
  house_number           int NOT NULL,
  role                   text NOT NULL CHECK (role IN ('leader', 'co_leader', 'member')),
  kind                   text,
  match_type             text,
  candidate_contact_ids  uuid[] NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'matched', 'new', 'skipped')),
  resolved_contact_id    uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  notes                  text,
  resolved_by            uuid REFERENCES public.users (id) ON DELETE SET NULL,
  resolved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_import_review_matched_contact_check
    CHECK (status <> 'matched' OR resolved_contact_id IS NOT NULL),
  CONSTRAINT missio_import_review_source_name_key
    UNIQUE (org_id, source_line, raw_name)
);

CREATE INDEX IF NOT EXISTS missio_import_review_org_status_idx
  ON public.missio_import_review (org_id, status);

COMMENT ON TABLE public.missio_import_review IS
  'Staging for the house-church sheet import. No real people are seeded. Pastors may resolve a row. Insert and delete are service-role only. Unique (org_id, source_line, raw_name) so one sheet line can split into several names and the import can upsert idempotently.';

COMMENT ON COLUMN public.missio_import_review.source_line IS
  '1-based line on the source sheet. Not unique by itself: one line can carry more than one name.';

COMMENT ON COLUMN public.missio_import_review.kind IS
  'Optional classifier from the import, for example person or family_label. Not a check constraint; the importer decides the vocabulary.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_import_review;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_import_review
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Every role, including service_role. A non-null resolved_contact_id
-- must be one of the staged candidates or an org_people row for this org.
CREATE OR REPLACE FUNCTION public.guard_missio_import_review_resolve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact_set boolean;
  v_at_changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_contact_set := NEW.resolved_contact_id IS NOT NULL;
    v_at_changed := NEW.resolved_at IS NOT NULL;
  ELSE
    v_contact_set := NEW.resolved_contact_id IS NOT NULL
      AND NEW.resolved_contact_id IS DISTINCT FROM OLD.resolved_contact_id;
    v_at_changed := NEW.resolved_at IS DISTINCT FROM OLD.resolved_at;
  END IF;

  IF v_contact_set
     AND NOT (NEW.resolved_contact_id = ANY (COALESCE(NEW.candidate_contact_ids, '{}')))
     AND NOT EXISTS (
       SELECT 1
       FROM public.org_people op
       WHERE op.org_id = NEW.org_id
         AND op.contact_id = NEW.resolved_contact_id
     ) THEN
    RAISE EXCEPTION 'missio_resolve_not_allowed'
      USING ERRCODE = '23503';
  END IF;

  -- Sending a row back to pending must not keep the previous
  -- resolver. releaseReview does this, and the pin below would
  -- otherwise write auth.uid() and now() straight back.
  IF NEW.status = 'pending' THEN
    NEW.resolved_by := NULL;
    NEW.resolved_at := NULL;
  ELSE
    IF auth.uid() IS NOT NULL THEN
      NEW.resolved_by := auth.uid();
    END IF;

    IF NEW.status IN ('matched', 'new', 'skipped')
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status)
    THEN
      NEW.resolved_at := now();
    ELSIF v_at_changed OR v_contact_set THEN
      NEW.resolved_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_missio_import_review_resolve() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_missio_import_review_resolve() IS
  'BEFORE INSERT OR UPDATE, every role. 23503 missio_resolve_not_allowed when a newly set resolved_contact_id is neither in candidate_contact_ids nor in org_people for the row org. status pending clears resolved_by and resolved_at for every role, including service role. A transition to matched, new, or skipped sets resolved_at to now(). When auth.uid() is set, resolved_by is overwritten with it on those statuses; a null auth.uid() keeps the supplied value.';

DROP TRIGGER IF EXISTS trg_missio_import_review_guard_resolve ON public.missio_import_review;
CREATE TRIGGER trg_missio_import_review_guard_resolve
  BEFORE INSERT OR UPDATE ON public.missio_import_review
  FOR EACH ROW EXECUTE FUNCTION public.guard_missio_import_review_resolve();

-- ────────────────────────────────────────────────────────────
-- 4. Derived membership
--    security_invoker so RLS on the base tables applies.
--    No names. org_people.status is not maintained from here.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.missio_member_status
WITH (security_invoker = true) AS
SELECT
  hc.org_id,
  m.contact_id,
  count(DISTINCT m.house_church_id)::int AS active_house_count,
  array_agg(DISTINCT hc.number ORDER BY hc.number) AS house_numbers,
  array_agg(DISTINCT m.role ORDER BY m.role) AS roles,
  true AS is_member
FROM public.house_church_members m
JOIN public.house_churches hc ON hc.id = m.house_church_id
JOIN public.organisations o ON o.id = hc.org_id
WHERE o.slug = 'missio'
  AND m.started_at <= current_date
  AND m.ended_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.org_people op
    WHERE op.org_id = hc.org_id
      AND op.contact_id = m.contact_id
  )
GROUP BY hc.org_id, m.contact_id;

ALTER VIEW public.missio_member_status SET (security_invoker = true);

COMMENT ON VIEW public.missio_member_status IS
  'One row per contact with a current Missio house-church membership. Current means ended_at IS NULL and started_at <= today, and the contact has an org_people row in that org. A future ended_at cannot be stored. is_member is always true. No names. security_invoker: RLS on the base tables applies. org_people rows are ensured by service-role API code when someone is added to a house. That sync is one-way and has no trigger. Leaving a house never changes org_people. org_people.status is NOT auto-synced.';

-- True only for a Missio pastor, and only when the contact has a
-- current membership. SECURITY DEFINER so the check can see
-- memberships the caller cannot read through the tables. It
-- returns false for everyone else, including FFSA admins, so the
-- bypass cannot be used as a probe. org_people.status is NOT
-- auto-synced by this function.
CREATE OR REPLACE FUNCTION public.is_missio_member(p_contact_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    public.has_org_role('missio', ARRAY['pastor'])
    AND EXISTS (
      SELECT 1
      FROM public.house_church_members m
      JOIN public.house_churches hc ON hc.id = m.house_church_id
      JOIN public.organisations o ON o.id = hc.org_id
      WHERE m.contact_id = p_contact_id
        AND o.slug = 'missio'
        AND m.started_at <= current_date
        AND m.ended_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM public.org_people op
          WHERE op.org_id = hc.org_id
            AND op.contact_id = m.contact_id
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_missio_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_missio_member(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.is_missio_member(uuid) IS
  'True when the caller is a Missio pastor and p_contact_id has a current Missio house-church membership: ended_at IS NULL, started_at on or before today, and an org_people row in that org. Returns false for every other caller, including FFSA admin and super_admin and a Missio org admin who is not a pastor. Does not write org_people. org_people rows are ensured by service-role API code when someone is added to a house (one-way, no trigger). Leaving a house never changes org_people. org_people.status is NOT auto-synced.';

-- ────────────────────────────────────────────────────────────
-- 5. RLS
--    Supabase default privileges grant new public tables to
--    anon and authenticated. Revoke anon and PUBLIC, then
--    grant authenticated only the commands a policy allows.
--    service_role keeps ALL and bypasses RLS.
--
--    missio_import_review UPDATE is column-level: a pastor can
--    resolve a row and cannot rewrite the sheet payload.
--    updated_at is not granted; handle_updated_at() sets it.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.house_churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.house_church_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_import_review ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.house_churches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.house_church_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_import_review FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_member_status FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.house_churches TO authenticated;
GRANT SELECT, INSERT ON TABLE public.house_church_members TO authenticated;
GRANT UPDATE (role, ended_at) ON TABLE public.house_church_members TO authenticated;
GRANT SELECT ON TABLE public.missio_import_review TO authenticated;
GRANT UPDATE (
  status,
  resolved_contact_id,
  notes,
  resolved_by,
  resolved_at
) ON TABLE public.missio_import_review TO authenticated;
GRANT SELECT ON TABLE public.missio_member_status TO authenticated;

GRANT ALL ON TABLE public.house_churches TO service_role;
GRANT ALL ON TABLE public.house_church_members TO service_role;
GRANT ALL ON TABLE public.missio_import_review TO service_role;
GRANT SELECT ON TABLE public.missio_member_status TO service_role;

-- house_churches: pastors, and only rows in the missio org.
DROP POLICY IF EXISTS "Pastors can read house churches" ON public.house_churches;
CREATE POLICY "Pastors can read house churches"
  ON public.house_churches
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can insert house churches" ON public.house_churches;
CREATE POLICY "Pastors can insert house churches"
  ON public.house_churches
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can update house churches" ON public.house_churches;
CREATE POLICY "Pastors can update house churches"
  ON public.house_churches
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can delete house churches" ON public.house_churches;

-- house_church_members: pastors, via the house church's org.
DROP POLICY IF EXISTS "Pastors can read house church members" ON public.house_church_members;
CREATE POLICY "Pastors can read house church members"
  ON public.house_church_members
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

DROP POLICY IF EXISTS "Pastors can insert house church members" ON public.house_church_members;
CREATE POLICY "Pastors can insert house church members"
  ON public.house_church_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
        AND EXISTS (
          SELECT 1
          FROM public.org_people op
          WHERE op.org_id = hc.org_id
            AND op.contact_id = house_church_members.contact_id
        )
    )
  );

DROP POLICY IF EXISTS "Pastors can update house church members" ON public.house_church_members;
CREATE POLICY "Pastors can update house church members"
  ON public.house_church_members
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.house_churches hc
      WHERE hc.id = house_church_id
        AND hc.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

DROP POLICY IF EXISTS "Pastors can delete house church members" ON public.house_church_members;

-- missio_import_review: pastors can read and resolve. No insert
-- policy and no delete policy. Column grants block the rest.
DROP POLICY IF EXISTS "Pastors can read import review" ON public.missio_import_review;
CREATE POLICY "Pastors can read import review"
  ON public.missio_import_review
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can resolve import review" ON public.missio_import_review;
CREATE POLICY "Pastors can resolve import review"
  ON public.missio_import_review
  FOR UPDATE
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

-- ────────────────────────────────────────────────────────────
-- 6. Seed 20 Potch houses. No names. No people.
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organisations WHERE slug = 'missio') THEN
    RAISE EXCEPTION 'migration 331 requires the missio organisation from migration 329';
  END IF;
END $$;

INSERT INTO public.house_churches (org_id, number, campus, name)
SELECT o.id, gs.n, 'potch', NULL
FROM public.organisations o
CROSS JOIN generate_series(1, 20) AS gs(n)
WHERE o.slug = 'missio'
ON CONFLICT (org_id, number) DO NOTHING;
