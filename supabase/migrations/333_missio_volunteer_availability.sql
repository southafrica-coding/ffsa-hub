-- ============================================================
-- FFSA Hub — Migration 333: Missio weekly volunteer availability
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Previews share the production database, so do not run
-- this in the Supabase SQL editor until Lead says so.
--
-- Hub-only v1. A volunteer opens a personal link, the server hashes
-- the token, and the service role reads and writes the answer.
-- Pastors of the Missio org manage teams and requests through
-- has_org_role. FFSA admin roles are not consulted.
--
-- HARD WALL. Policies call
--   (SELECT public.has_org_role('missio', ARRAY['pastor']))
-- and nothing else. No is_admin bypass, no FFSA role helper, no
-- contacts permission. availability_tokens has no policy for
-- anon or authenticated: the raw token is never stored, and the
-- hash is service-role only. availability_responses are written
-- the same way. Authenticated pastors may SELECT responses so
-- the grid can render. They cannot insert or update them.
--
-- A later Planning Center blockout sync can read these rows.
-- This file does not create pco_person_links or pco_blockout_links.
--
-- Leader contacts are missio_team_leaders, a join to contacts(id),
-- same as missio_team_members.contact_id. An uuid[] cannot
-- reference contacts, so the array shape is not used.
--
-- Idempotent: CREATE IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY
-- IF EXISTS, DROP TRIGGER IF EXISTS.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Helpers
--    search_path is empty on every function. SECURITY DEFINER
--    helpers qualify public.* and do not consult FFSA roles.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.availability_dates_in_range(
  p_starts date,
  p_ends date,
  p_dates date[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_starts IS NOT NULL
    AND p_ends IS NOT NULL
    AND p_starts <= p_ends
    AND p_dates IS NOT NULL
    AND pg_catalog.cardinality(p_dates) BETWEEN 1 AND 12
    AND pg_catalog.cardinality(p_dates) = (
      SELECT count(DISTINCT day)
      FROM pg_catalog.unnest(p_dates) AS u(day)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(p_dates) AS u(day)
      WHERE day IS NULL OR day < p_starts OR day > p_ends
    );
$$;

REVOKE ALL ON FUNCTION public.availability_dates_in_range(date, date, date[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.availability_dates_in_range(date, date, date[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.availability_dates_in_range(date, date, date[]) IS
  'True when service dates are unique, between 1 and 12, and inside the request range.';

CREATE OR REPLACE FUNCTION public.missio_volunteer_org_is_missio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organisations o
    WHERE o.id = NEW.org_id
      AND o.slug = 'missio'
  ) THEN
    RAISE EXCEPTION 'volunteer availability belongs to Missio'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_volunteer_org_is_missio() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missio_volunteer_org_is_missio() TO authenticated, service_role;

COMMENT ON FUNCTION public.missio_volunteer_org_is_missio() IS
  'Rejects a team or request whose org is not the Missio organisation. Does not consult FFSA roles.';

CREATE OR REPLACE FUNCTION public.missio_volunteer_contact_in_org()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.missio_teams t
    JOIN public.org_people op
      ON op.org_id = t.org_id
     AND op.contact_id = NEW.contact_id
    WHERE t.id = NEW.team_id
  ) THEN
    RAISE EXCEPTION 'missio_contact_not_in_org'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_volunteer_contact_in_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missio_volunteer_contact_in_org() TO authenticated, service_role;

COMMENT ON FUNCTION public.missio_volunteer_contact_in_org() IS
  'A team member or leader must already be an org_people row for that team''s org.';

CREATE OR REPLACE FUNCTION public.availability_response_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dates date[];
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.request_id IS DISTINCT FROM NEW.request_id
       OR OLD.contact_id IS DISTINCT FROM NEW.contact_id
       OR OLD.service_date IS DISTINCT FROM NEW.service_date THEN
      RAISE EXCEPTION 'availability responses keep their request, person, and date'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT r.service_dates
    INTO v_dates
    FROM public.availability_requests r
   WHERE r.id = NEW.request_id;

  IF v_dates IS NULL OR NOT (NEW.service_date = ANY (v_dates)) THEN
    RAISE EXCEPTION 'service date is not on this request'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Editable on the service date itself (Johannesburg). The next
  -- calendar day is closed, including a row that was written earlier.
  IF NEW.service_date < (pg_catalog.timezone('Africa/Johannesburg', pg_catalog.now()))::date THEN
    RAISE EXCEPTION 'availability is closed for this service date'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.note IS NOT NULL AND pg_catalog.char_length(pg_catalog.btrim(NEW.note)) = 0 THEN
    NEW.note := NULL;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.availability_response_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.availability_response_guard() TO service_role;

COMMENT ON FUNCTION public.availability_response_guard() IS
  'Service-role writes only. Rejects a past Johannesburg service date and a date that is not on the request.';

-- The creator is the signed-in user. A caller cannot supply or change it.
CREATE OR REPLACE FUNCTION public.availability_request_stamp_creator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
  ELSE
    NEW.created_by := OLD.created_by;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.availability_request_stamp_creator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.availability_request_stamp_creator() TO authenticated, service_role;

COMMENT ON FUNCTION public.availability_request_stamp_creator() IS
  'Sets availability_requests.created_by from auth.uid() on insert and refuses a later change.';

-- Tokens and answers are only for someone already in this org and on a team.
-- The trigger runs for every role, including service_role (RLS bypass does not skip it).
CREATE OR REPLACE FUNCTION public.missio_availability_contact_on_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
BEGIN
  SELECT r.org_id
    INTO v_org
    FROM public.availability_requests r
   WHERE r.id = NEW.request_id;

  IF v_org IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.org_people op
        WHERE op.org_id = v_org
          AND op.contact_id = NEW.contact_id
     )
     OR NOT EXISTS (
       SELECT 1
         FROM public.missio_teams t
        WHERE t.org_id = v_org
          AND (
            EXISTS (
              SELECT 1
                FROM public.missio_team_members m
               WHERE m.team_id = t.id
                 AND m.contact_id = NEW.contact_id
            )
            OR EXISTS (
              SELECT 1
                FROM public.missio_team_leaders l
               WHERE l.team_id = t.id
                 AND l.contact_id = NEW.contact_id
            )
          )
     )
  THEN
    RAISE EXCEPTION 'missio_contact_not_in_org'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_availability_contact_on_roster() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.missio_availability_contact_on_roster() TO service_role;

COMMENT ON FUNCTION public.missio_availability_contact_on_roster() IS
  'A token or answer requires the contact in org_people for the request org and on a team roster there. Raises missio_contact_not_in_org (23503).';

-- ────────────────────────────────────────────────────────────
-- 2. Tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.missio_teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

COMMENT ON TABLE public.missio_teams IS
  'A Missio serving team. Pastors of the Missio org manage rows. FFSA admin roles are not a pass.';

CREATE INDEX IF NOT EXISTS missio_teams_org_id_idx
  ON public.missio_teams (org_id);

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_teams;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_missio_teams_org ON public.missio_teams;
CREATE TRIGGER trg_missio_teams_org
  BEFORE INSERT OR UPDATE OF org_id ON public.missio_teams
  FOR EACH ROW EXECUTE FUNCTION public.missio_volunteer_org_is_missio();

-- Leaders reference contacts(id). A uuid[] cannot.
CREATE TABLE IF NOT EXISTS public.missio_team_leaders (
  team_id    uuid NOT NULL REFERENCES public.missio_teams (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, contact_id)
);

COMMENT ON TABLE public.missio_team_leaders IS
  'Leader contacts for a Missio team. contact_id references contacts(id).';

CREATE INDEX IF NOT EXISTS missio_team_leaders_contact_id_idx
  ON public.missio_team_leaders (contact_id);

DROP TRIGGER IF EXISTS trg_missio_team_leaders_contact ON public.missio_team_leaders;
CREATE TRIGGER trg_missio_team_leaders_contact
  BEFORE INSERT OR UPDATE OF team_id, contact_id ON public.missio_team_leaders
  FOR EACH ROW EXECUTE FUNCTION public.missio_volunteer_contact_in_org();

CREATE TABLE IF NOT EXISTS public.missio_team_members (
  team_id    uuid NOT NULL REFERENCES public.missio_teams (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, contact_id)
);

COMMENT ON TABLE public.missio_team_members IS
  'Members of a Missio team. contact_id references contacts(id). One row per team and contact.';

CREATE INDEX IF NOT EXISTS missio_team_members_contact_id_idx
  ON public.missio_team_members (contact_id);

DROP TRIGGER IF EXISTS trg_missio_team_members_contact ON public.missio_team_members;
CREATE TRIGGER trg_missio_team_members_contact
  BEFORE INSERT OR UPDATE OF team_id, contact_id ON public.missio_team_members
  FOR EACH ROW EXECUTE FUNCTION public.missio_volunteer_contact_in_org();

CREATE TABLE IF NOT EXISTS public.availability_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  service_dates date[] NOT NULL,
  created_by    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_requests_dates_in_range
    CHECK (public.availability_dates_in_range(starts_on, ends_on, service_dates))
);

COMMENT ON TABLE public.availability_requests IS
  'One ask for a set of service dates. The public page shows the next 4 to 6 of service_dates.';

CREATE INDEX IF NOT EXISTS availability_requests_org_id_idx
  ON public.availability_requests (org_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_availability_requests_org ON public.availability_requests;
CREATE TRIGGER trg_availability_requests_org
  BEFORE INSERT OR UPDATE OF org_id ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.missio_volunteer_org_is_missio();

DROP TRIGGER IF EXISTS trg_availability_requests_creator ON public.availability_requests;
CREATE TRIGGER trg_availability_requests_creator
  BEFORE INSERT OR UPDATE ON public.availability_requests
  FOR EACH ROW EXECUTE FUNCTION public.availability_request_stamp_creator();

-- Hash only. No raw token column. No anon or authenticated policy.
CREATE TABLE IF NOT EXISTS public.availability_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.availability_requests (id) ON DELETE CASCADE,
  contact_id  uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  -- Random per row. The raw link is HMAC(secret, request_id || contact_id || nonce)
  -- and is not stored. token_hash is SHA-256 of that raw link.
  nonce       text NOT NULL CHECK (nonce ~ '^[A-Za-z0-9_-]{43}$'),
  token_hash  text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT availability_tokens_request_contact_key UNIQUE (request_id, contact_id),
  CONSTRAINT availability_tokens_token_hash_key UNIQUE (token_hash)
);

COMMENT ON TABLE public.availability_tokens IS
  'Service-role only. Stores a nonce and the SHA-256 of the HMAC link. The raw token is derived when a pastor copies it and is never stored.';

COMMENT ON COLUMN public.availability_tokens.token_hash IS
  'SHA-256 hex of the raw link token. Not the token itself.';

CREATE INDEX IF NOT EXISTS availability_tokens_request_id_idx
  ON public.availability_tokens (request_id);

DROP TRIGGER IF EXISTS trg_availability_tokens_roster ON public.availability_tokens;
CREATE TRIGGER trg_availability_tokens_roster
  BEFORE INSERT OR UPDATE ON public.availability_tokens
  FOR EACH ROW EXECUTE FUNCTION public.missio_availability_contact_on_roster();

CREATE TABLE IF NOT EXISTS public.availability_responses (
  request_id   uuid NOT NULL REFERENCES public.availability_requests (id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  service_date date NOT NULL,
  status       text NOT NULL CHECK (status IN ('available', 'unavailable', 'maybe')),
  note         text CHECK (note IS NULL OR pg_catalog.char_length(note) <= 500),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, contact_id, service_date)
);

COMMENT ON TABLE public.availability_responses IS
  'One answer per person per service date. Writes are service-role only, after the public token is verified. Editable until the service date in Africa/Johannesburg, inclusive. A later Planning Center sync may read these rows; it is not wired here.';

CREATE INDEX IF NOT EXISTS availability_responses_request_date_idx
  ON public.availability_responses (request_id, service_date);

DROP TRIGGER IF EXISTS set_updated_at ON public.availability_responses;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_availability_response_guard ON public.availability_responses;
CREATE TRIGGER trg_availability_response_guard
  BEFORE INSERT OR UPDATE ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.availability_response_guard();

DROP TRIGGER IF EXISTS trg_availability_responses_roster ON public.availability_responses;
CREATE TRIGGER trg_availability_responses_roster
  BEFORE INSERT OR UPDATE ON public.availability_responses
  FOR EACH ROW EXECUTE FUNCTION public.missio_availability_contact_on_roster();

-- ────────────────────────────────────────────────────────────
-- 3. Grants and RLS
--    Supabase default privileges grant new public tables to
--    anon and authenticated. Revoke anon and PUBLIC first.
--    availability_tokens stays revoked for both anon and
--    authenticated. Responses are SELECT-only for pastors.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.missio_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_team_leaders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.availability_responses ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_teams FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_team_leaders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_team_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_tokens FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.availability_responses FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.missio_teams TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.missio_team_leaders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.missio_team_members TO authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.availability_requests TO authenticated;
GRANT SELECT ON TABLE public.availability_responses TO authenticated;

GRANT ALL ON TABLE public.missio_teams TO service_role;
GRANT ALL ON TABLE public.missio_team_leaders TO service_role;
GRANT ALL ON TABLE public.missio_team_members TO service_role;
GRANT ALL ON TABLE public.availability_requests TO service_role;
GRANT ALL ON TABLE public.availability_tokens TO service_role;
GRANT ALL ON TABLE public.availability_responses TO service_role;

-- Pastor expression, evaluated once per statement. Org id must be Missio
-- even when the caller holds the pastor role.
DROP POLICY IF EXISTS "Missio pastors manage teams" ON public.missio_teams;
CREATE POLICY "Missio pastors manage teams"
  ON public.missio_teams
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Missio pastors manage team leaders" ON public.missio_team_leaders;
CREATE POLICY "Missio pastors manage team leaders"
  ON public.missio_team_leaders
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.missio_teams t
      WHERE t.id = team_id
        AND t.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.missio_teams t
      WHERE t.id = team_id
        AND t.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

DROP POLICY IF EXISTS "Missio pastors manage team members" ON public.missio_team_members;
CREATE POLICY "Missio pastors manage team members"
  ON public.missio_team_members
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.missio_teams t
      WHERE t.id = team_id
        AND t.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.missio_teams t
      WHERE t.id = team_id
        AND t.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );

DROP POLICY IF EXISTS "Missio pastors manage availability requests" ON public.availability_requests;

DROP POLICY IF EXISTS "Missio pastors read availability requests" ON public.availability_requests;
CREATE POLICY "Missio pastors read availability requests"
  ON public.availability_requests
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Missio pastors insert availability requests" ON public.availability_requests;
CREATE POLICY "Missio pastors insert availability requests"
  ON public.availability_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Missio pastors delete availability requests" ON public.availability_requests;
CREATE POLICY "Missio pastors delete availability requests"
  ON public.availability_requests
  FOR DELETE
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

-- No policy on availability_tokens. RLS on, grants revoked.

DROP POLICY IF EXISTS "Missio pastors read availability responses" ON public.availability_responses;
CREATE POLICY "Missio pastors read availability responses"
  ON public.availability_responses
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND EXISTS (
      SELECT 1
      FROM public.availability_requests r
      WHERE r.id = request_id
        AND r.org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    )
  );
