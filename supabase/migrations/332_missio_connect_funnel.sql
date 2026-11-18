-- ============================================================
-- FFSA Hub — Migration 332: Missio connect card + follow-up
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Depends on 329 (organisations, has_org_role,
-- contact_labels, the missio label) and 331 (house_churches,
-- house_church_members).
--
-- The connect card and the follow-up pipeline sit inside the
-- Missio wall. Every policy calls
-- (SELECT public.has_org_role('missio', ARRAY['pastor'])) and
-- checks the row belongs to the missio organisation.
-- is_admin(), has_role(), has_any_role() and contacts permissions
-- are not consulted. An FFSA admin or super_admin does not pass.
-- A Missio org admin who is not a pastor does not pass.
--
-- Public QR submissions are inserted by a service-role API.
-- There is no anon grant and no anon policy. A pastor may insert
-- only source = 'manual'.
--
-- A connect response does not create a follow-up. Joining a
-- house does not create a follow-up either. The joined trigger
-- only moves an existing follow-up.
--
-- No people and no names are seeded.
--
-- Idempotent: CREATE IF NOT EXISTS, CREATE OR REPLACE, DROP
-- POLICY IF EXISTS, DROP TRIGGER IF EXISTS.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. connect_responses
--    The card someone fills in at a service.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.connect_responses (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  name                text NOT NULL,
  phone               text NOT NULL,
  email               text,
  visit_type          text NOT NULL CHECK (visit_type IN ('first_time', 'been_a_while', 'regular')),
  wants_house_church  boolean NOT NULL DEFAULT false,
  wants_prayer        boolean NOT NULL DEFAULT false,
  prayer_request      text,
  notes               text,
  service_date        date,
  campus              text NOT NULL DEFAULT 'potch' CHECK (campus IN ('potch', 'jhb')),
  matched_contact_id  uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  matched_by          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  matched_at          timestamptz,
  source              text NOT NULL CHECK (source IN ('qr', 'manual', 'pco')),
  -- HMAC of an IP or a device id. The API stores the hash. Never a raw IP.
  rate_key_hash       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connect_responses_org_submitted_idx
  ON public.connect_responses (org_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS connect_responses_matched_contact_idx
  ON public.connect_responses (matched_contact_id);

CREATE INDEX IF NOT EXISTS connect_responses_rate_key_created_idx
  ON public.connect_responses (rate_key_hash, created_at);

COMMENT ON TABLE public.connect_responses IS
  'A Missio connect card. Public QR and PCO rows are inserted by the service role. Pastors may insert only source manual, and may update. No delete policy.';

COMMENT ON COLUMN public.connect_responses.visit_type IS
  'first_time, been_a_while, or regular.';

COMMENT ON COLUMN public.connect_responses.rate_key_hash IS
  'HMAC of an IP or a device id, written by the API for rate limiting. Never a raw IP.';

COMMENT ON COLUMN public.connect_responses.source IS
  'qr, manual, or pco. Authenticated insert is limited to manual. qr and pco are service-role only.';

DROP TRIGGER IF EXISTS set_updated_at ON public.connect_responses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 2. missio_followups
--    One pipeline row per person. assigned_leader_contact_id
--    is the main assignee. assigned_user_id is optional.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.missio_followups (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid NOT NULL REFERENCES public.organisations (id) ON DELETE RESTRICT,
  contact_id                  uuid REFERENCES public.contacts (id) ON DELETE RESTRICT,
  connect_response_id         uuid REFERENCES public.connect_responses (id) ON DELETE SET NULL,
  stage                       text NOT NULL DEFAULT 'new'
                                CHECK (stage IN ('new', 'contacted', 'visited_house', 'joined')),
  assigned_leader_contact_id  uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  assigned_user_id            uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT missio_followups_subject_check
    CHECK (contact_id IS NOT NULL OR connect_response_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS missio_followups_org_contact_uidx
  ON public.missio_followups (org_id, contact_id)
  WHERE contact_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS missio_followups_connect_response_uidx
  ON public.missio_followups (connect_response_id)
  WHERE connect_response_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS missio_followups_org_id_idx
  ON public.missio_followups (org_id);

COMMENT ON TABLE public.missio_followups IS
  'One Missio follow-up per person in the pipeline. Not created automatically from a connect card or from a house membership. Pastors may select, insert and update. Delete is service-role only.';

COMMENT ON COLUMN public.missio_followups.assigned_leader_contact_id IS
  'The main assignee. A contact, not a login. assigned_user_id is an optional hub user on the same row.';

COMMENT ON COLUMN public.missio_followups.assigned_user_id IS
  'Optional hub user. The main assignee is assigned_leader_contact_id.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_followups;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_followups
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ────────────────────────────────────────────────────────────
-- 3. missio_followup_stage_history
--    The timeline. The stage trigger writes kind = stage_change.
--    Pastors insert kind = note only.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.missio_followup_stage_history (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  followup_id  uuid NOT NULL REFERENCES public.missio_followups (id) ON DELETE CASCADE,
  from_stage   text CHECK (
                 from_stage IS NULL
                 OR from_stage IN ('new', 'contacted', 'visited_house', 'joined')
               ),
  to_stage     text CHECK (
                 to_stage IS NULL
                 OR to_stage IN ('new', 'contacted', 'visited_house', 'joined')
               ),
  changed_by   uuid DEFAULT auth.uid() REFERENCES public.users (id) ON DELETE SET NULL,
  changed_at   timestamptz NOT NULL DEFAULT now(),
  notes        text,
  kind         text NOT NULL DEFAULT 'stage_change'
                 CHECK (kind IN ('stage_change', 'note')),
  CONSTRAINT missio_followup_stage_history_shape_check
    CHECK (
      (kind = 'stage_change' AND to_stage IS NOT NULL)
      OR (kind = 'note' AND notes IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS missio_followup_stage_history_followup_idx
  ON public.missio_followup_stage_history (followup_id, changed_at);

COMMENT ON TABLE public.missio_followup_stage_history IS
  'Timeline for a follow-up. kind stage_change is written by the stage trigger. kind note is a pastor inserting a note. No update and no delete for authenticated.';

COMMENT ON COLUMN public.missio_followup_stage_history.kind IS
  'stage_change or note. stage_change requires to_stage. note requires notes.';

-- Writes a stage_change row only when the stage actually changes.
-- SECURITY DEFINER so the insert is not blocked by the pastor
-- policy that allows kind = note only. search_path is empty.
CREATE OR REPLACE FUNCTION public.record_missio_followup_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.stage IS NOT DISTINCT FROM OLD.stage THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.missio_followup_stage_history (
    followup_id, from_stage, to_stage, changed_by, kind
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.stage END,
    NEW.stage,
    (SELECT auth.uid()),
    'stage_change'
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.record_missio_followup_stage() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.record_missio_followup_stage() IS
  'AFTER INSERT OR UPDATE OF stage on missio_followups. Inserts a stage_change timeline row when the stage changes, including the insert that creates the follow-up. A no-op update writes nothing.';

DROP TRIGGER IF EXISTS trg_missio_followup_stage_history ON public.missio_followups;
CREATE TRIGGER trg_missio_followup_stage_history
  AFTER INSERT OR UPDATE OF stage ON public.missio_followups
  FOR EACH ROW EXECUTE FUNCTION public.record_missio_followup_stage();

-- ────────────────────────────────────────────────────────────
-- 4. Auto-joined
--    An active Missio house membership moves an existing
--    follow-up to joined. It never inserts a follow-up.
--    Active matches missio_member_status: started_at on or
--    before today, and ended_at null or after today.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_missio_followup_joined()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.started_at > current_date THEN
    RETURN NEW;
  END IF;
  IF NEW.ended_at IS NOT NULL AND NEW.ended_at <= current_date THEN
    RETURN NEW;
  END IF;

  UPDATE public.missio_followups f
     SET stage = 'joined'
   WHERE f.contact_id = NEW.contact_id
     AND f.stage IS DISTINCT FROM 'joined'
     AND f.org_id = (
       SELECT hc.org_id
       FROM public.house_churches hc
       JOIN public.organisations o ON o.id = hc.org_id
       WHERE hc.id = NEW.house_church_id
         AND o.slug = 'missio'
     );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_missio_followup_joined() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.mark_missio_followup_joined() IS
  'When a current Missio house membership is written, set that contact''s existing missio_followups.stage to joined. Current means started_at <= today and ended_at is null or after today. Does not insert a follow-up. Does not change org_people. A membership that has already ended is ignored.';

DROP TRIGGER IF EXISTS trg_house_church_member_mark_joined ON public.house_church_members;
CREATE TRIGGER trg_house_church_member_mark_joined
  AFTER INSERT OR UPDATE ON public.house_church_members
  FOR EACH ROW EXECUTE FUNCTION public.mark_missio_followup_joined();

-- ────────────────────────────────────────────────────────────
-- 5. missio_followup_effective
--    security_invoker so RLS on the base tables applies.
--    effective_stage is joined while a current membership
--    exists, otherwise the stored stage.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.missio_followup_effective
WITH (security_invoker = true) AS
SELECT
  f.id,
  f.org_id,
  f.contact_id,
  f.connect_response_id,
  f.stage,
  f.assigned_leader_contact_id,
  f.assigned_user_id,
  f.created_at,
  f.updated_at,
  CASE
    WHEN f.contact_id IS NOT NULL AND EXISTS (
      SELECT 1
      FROM public.house_church_members m
      JOIN public.house_churches hc ON hc.id = m.house_church_id
      JOIN public.organisations o ON o.id = hc.org_id
      WHERE m.contact_id = f.contact_id
        AND hc.org_id = f.org_id
        AND o.slug = 'missio'
        AND m.started_at <= current_date
        AND (m.ended_at IS NULL OR m.ended_at > current_date)
    ) THEN 'joined'
    ELSE f.stage
  END AS effective_stage
FROM public.missio_followups f;

ALTER VIEW public.missio_followup_effective SET (security_invoker = true);

COMMENT ON VIEW public.missio_followup_effective IS
  'Follow-up rows plus effective_stage. effective_stage is joined while the contact has a current Missio house membership, otherwise the stored stage. security_invoker: RLS applies. Does not write.';

-- ────────────────────────────────────────────────────────────
-- 6. missio_not_in_house
--    People with no current Missio house membership, from the
--    Missio contact label and from connect cards. Owner-rights
--    and a security barrier, same pattern as
--    org_people_directory: a pastor cannot read contacts, so
--    the view reads them as the owner and then keeps a row
--    only when the caller is a Missio pastor.
--
--    A card matched to a labelled contact is not a second row.
--    That person is the contact row, with the latest card's id
--    filled in. A card matched to someone who already has a
--    current membership is left out.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.missio_not_in_house
WITH (security_invoker = false, security_barrier = true) AS
WITH missio AS (
  SELECT o.id AS org_id, o.contact_label_id
  FROM public.organisations o
  WHERE o.slug = 'missio'
),
active_member AS (
  SELECT m.contact_id, hc.org_id
  FROM public.house_church_members m
  JOIN public.house_churches hc ON hc.id = m.house_church_id
  JOIN missio mo ON mo.org_id = hc.org_id
  WHERE m.started_at <= current_date
    AND (m.ended_at IS NULL OR m.ended_at > current_date)
),
labelled_outside AS (
  SELECT mo.org_id, cl.contact_id
  FROM missio mo
  JOIN public.contact_labels cl ON cl.label_id = mo.contact_label_id
  WHERE mo.contact_label_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM active_member am
      WHERE am.contact_id = cl.contact_id
        AND am.org_id = mo.org_id
    )
),
contact_rows AS (
  SELECT
    'contact'::text AS source,
    l.contact_id,
    lr.id AS connect_response_id,
    btrim(c.first_name || ' ' || c.last_name) AS display_name,
    c.phone,
    c.email,
    lr.wants_house_church,
    f.stage AS followup_stage,
    lr.submitted_at
  FROM labelled_outside l
  JOIN public.contacts c ON c.id = l.contact_id
  LEFT JOIN LATERAL (
    SELECT cr.id, cr.wants_house_church, cr.submitted_at
    FROM public.connect_responses cr
    WHERE cr.org_id = l.org_id
      AND cr.matched_contact_id = l.contact_id
    ORDER BY cr.submitted_at DESC, cr.id DESC
    LIMIT 1
  ) lr ON true
  LEFT JOIN LATERAL (
    SELECT fu.stage
    FROM public.missio_followups fu
    WHERE fu.org_id = l.org_id
      AND (
        fu.contact_id = l.contact_id
        OR (lr.id IS NOT NULL AND fu.connect_response_id = lr.id)
      )
    ORDER BY (fu.contact_id IS NOT NULL) DESC, fu.created_at DESC
    LIMIT 1
  ) f ON true
  WHERE (SELECT public.has_org_role('missio', ARRAY['pastor']))
),
response_rows AS (
  SELECT
    'connect_response'::text AS source,
    cr.matched_contact_id AS contact_id,
    cr.id AS connect_response_id,
    CASE
      WHEN c.id IS NOT NULL THEN btrim(c.first_name || ' ' || c.last_name)
      ELSE cr.name
    END AS display_name,
    COALESCE(c.phone, cr.phone) AS phone,
    COALESCE(c.email, cr.email) AS email,
    cr.wants_house_church,
    f.stage AS followup_stage,
    cr.submitted_at
  FROM public.connect_responses cr
  JOIN missio mo ON mo.org_id = cr.org_id
  LEFT JOIN public.contacts c ON c.id = cr.matched_contact_id
  LEFT JOIN LATERAL (
    SELECT fu.stage
    FROM public.missio_followups fu
    WHERE fu.org_id = cr.org_id
      AND (
        fu.connect_response_id = cr.id
        OR (
          cr.matched_contact_id IS NOT NULL
          AND fu.contact_id = cr.matched_contact_id
        )
      )
    ORDER BY (fu.connect_response_id = cr.id) DESC, fu.created_at DESC
    LIMIT 1
  ) f ON true
  WHERE (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND (
      cr.matched_contact_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM active_member am
        WHERE am.contact_id = cr.matched_contact_id
          AND am.org_id = cr.org_id
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM labelled_outside l
      WHERE l.contact_id = cr.matched_contact_id
        AND l.org_id = cr.org_id
    )
)
SELECT
  people.source,
  people.contact_id,
  people.connect_response_id,
  people.display_name,
  people.phone,
  people.email,
  people.wants_house_church,
  people.followup_stage,
  people.submitted_at
FROM (
  SELECT * FROM contact_rows
  UNION ALL
  SELECT * FROM response_rows
) people
WHERE (SELECT public.has_org_role('missio', ARRAY['pastor']));

ALTER VIEW public.missio_not_in_house
  SET (security_invoker = false, security_barrier = true);
ALTER VIEW public.missio_not_in_house OWNER TO postgres;

COMMENT ON VIEW public.missio_not_in_house IS
  'People with no current Missio house membership. source contact is a contact carrying the Missio label. source connect_response is a card that is unmatched, or matched to someone who is not a current member and not already shown as a labelled contact. A card matched to a labelled contact is folded into that contact row (latest card by submitted_at). Names, phone and email come from contacts when a contact is known, otherwise from the card. Owner-rights and a security barrier, gated by has_org_role(missio, pastor). No other role, including FFSA admin, gets a row.';

-- ────────────────────────────────────────────────────────────
-- 7. RLS
--    Revoke anon and PUBLIC. Grant authenticated only the
--    commands a policy allows. service_role keeps ALL and
--    bypasses RLS, which is how QR inserts and deletes are made.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.connect_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_followups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_followup_stage_history ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.connect_responses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_followups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_followup_stage_history FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_followup_effective FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_not_in_house FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.connect_responses TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.missio_followups TO authenticated;
GRANT SELECT, INSERT ON TABLE public.missio_followup_stage_history TO authenticated;
GRANT SELECT ON TABLE public.missio_followup_effective TO authenticated;
GRANT SELECT ON TABLE public.missio_not_in_house TO authenticated;

GRANT ALL ON TABLE public.connect_responses TO service_role;
GRANT ALL ON TABLE public.missio_followups TO service_role;
GRANT ALL ON TABLE public.missio_followup_stage_history TO service_role;
GRANT SELECT ON TABLE public.missio_followup_effective TO service_role;
GRANT SELECT ON TABLE public.missio_not_in_house TO service_role;

DROP POLICY IF EXISTS "Pastors can read connect responses" ON public.connect_responses;
CREATE POLICY "Pastors can read connect responses"
  ON public.connect_responses
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can insert manual connect responses" ON public.connect_responses;
CREATE POLICY "Pastors can insert manual connect responses"
  ON public.connect_responses
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    AND source = 'manual'
  );

DROP POLICY IF EXISTS "Pastors can update connect responses" ON public.connect_responses;
CREATE POLICY "Pastors can update connect responses"
  ON public.connect_responses
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

DROP POLICY IF EXISTS "Pastors can read followups" ON public.missio_followups;
CREATE POLICY "Pastors can read followups"
  ON public.missio_followups
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can insert followups" ON public.missio_followups;
CREATE POLICY "Pastors can insert followups"
  ON public.missio_followups
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Pastors can update followups" ON public.missio_followups;
CREATE POLICY "Pastors can update followups"
  ON public.missio_followups
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

DROP POLICY IF EXISTS "Pastors can read followup history" ON public.missio_followup_stage_history;
CREATE POLICY "Pastors can read followup history"
  ON public.missio_followup_stage_history
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.missio_followups f
      WHERE f.id = followup_id
        AND f.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

DROP POLICY IF EXISTS "Pastors can insert followup notes" ON public.missio_followup_stage_history;
CREATE POLICY "Pastors can insert followup notes"
  ON public.missio_followup_stage_history
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND kind = 'note'
    AND EXISTS (
      SELECT 1
      FROM public.missio_followups f
      WHERE f.id = followup_id
        AND f.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );
