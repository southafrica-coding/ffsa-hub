-- ============================================================
-- FFSA Hub — Migration 424: P&W songwriting v2 (leads, dates, nation codes)
-- ============================================================
-- Depends on 417. Applied by hand, on prod only with Jack's explicit OK.
-- No data here: no nations, codes, leads or people are seeded.
--
-- What the Songwriting department API (trainings, nations, leads) and
-- Hub UI #745 need on top of 417:
--   * pw_nations.iso_code   ISO 3166-1 alpha-2 (two capital letters),
--                           unique where set. Null = not set yet.
--   * pw_nations.languages  text[] the nation's languages, the same shape
--                           as pw_songwriting_trainings.languages (417)
--                           and the string[] the UI renders.
--   * pw_songwriting_trainings.training_date
--                           optional day; must fall in the row's
--                           year/month (year + month stay the grouping
--                           key; the sheet only ever had months).
--   * pw_songwriting_leads  people, organisations or groups to follow up,
--                           by nation and/or source training. Shaped
--                           like #745's SongwritingLead. Contact details
--                           stay in the CRM: no email or phone columns.
--   * pw_songwriting_lead_events
--                           "Log contact" rows, shaped like #745's
--                           SongwritingLeadEvent. Append-only for
--                           signed-in callers.
-- pw_songs is unchanged (kept thin).
--
-- Access: 417's. Every new table uses pw_can_access_songwriting()
-- (SECURITY DEFINER, search_path '') for read and write: active
-- prayer_and_worship members and admins only; anon has no grants.
-- On top of that, for signed-in callers (authenticated / anon; service_role
-- and the owner are exempt):
--   * actors are stamped: pw_songwriting_leads.created_by and
--     pw_songwriting_lead_events.by are set to auth.uid() on INSERT
--     (whatever was sent) and cannot change on UPDATE
--     → 42501 pw_songwriting_actor_locked
--   * lead events are append-only: no UPDATE grant or policy (42501);
--     DELETE only by the event's author or an admin (a mistaken log is
--     deleted and logged again)
--   * pw_songwriting_leads.last_contact_at is derived: max(event.at),
--     moved forward on event insert and recomputed when an event is
--     deleted or (service_role) edited. Signed-in callers cannot set it
--     → 42501 pw_lead_last_contact_derived
--   * service_role must name the actor on an event
--     → 23514 pw_lead_event_actor_required
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraints, IF NOT
-- EXISTS tables and indexes, DROP ... IF EXISTS before CREATE.
-- Rollback: supabase/rollbacks/424_pw_songwriting_v2_rollback.sql
-- (run it before 417's rollback).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Nations: iso_code, languages
-- ────────────────────────────────────────────────────────────

-- True when no entry is null, empty or whitespace only. IMMUTABLE so it
-- can sit in a CHECK (a CHECK cannot hold a subquery).
CREATE OR REPLACE FUNCTION public.pw_text_array_no_blanks(p text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(p) x WHERE x IS NULL OR x !~ '\S');
$$;

ALTER TABLE public.pw_nations ADD COLUMN IF NOT EXISTS iso_code text;
ALTER TABLE public.pw_nations ADD COLUMN IF NOT EXISTS languages text[] NOT NULL DEFAULT '{}'::text[];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pw_nations'::regclass
                    AND conname = 'pw_nations_iso_code_format') THEN
    ALTER TABLE public.pw_nations
      ADD CONSTRAINT pw_nations_iso_code_format
      CHECK (iso_code IS NULL OR iso_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

-- No null, empty or whitespace-only entries. (Duplicates are the API's
-- job, as on trainings.) Dropped and re-added so a re-run picks up this
-- definition over an earlier one.
ALTER TABLE public.pw_nations DROP CONSTRAINT IF EXISTS pw_nations_languages_no_blanks;
ALTER TABLE public.pw_nations
  ADD CONSTRAINT pw_nations_languages_no_blanks
  CHECK (public.pw_text_array_no_blanks(languages));

CREATE UNIQUE INDEX IF NOT EXISTS pw_nations_iso_code_key
  ON public.pw_nations (iso_code) WHERE iso_code IS NOT NULL;

COMMENT ON COLUMN public.pw_nations.iso_code IS
  'ISO 3166-1 alpha-2, upper case (ZA, TZ, GB). Unique where set. Null = not set. Constituent countries (England) have no alpha-2 of their own.';
COMMENT ON COLUMN public.pw_nations.languages IS
  'Languages of this nation, as display strings (for example {"Swahili","English"}). Trainings keep their own languages (417).';

-- ────────────────────────────────────────────────────────────
-- 2. Trainings: optional day
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.pw_songwriting_trainings ADD COLUMN IF NOT EXISTS training_date date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pw_songwriting_trainings'::regclass
                    AND conname = 'pw_songwriting_trainings_date_in_month') THEN
    ALTER TABLE public.pw_songwriting_trainings
      ADD CONSTRAINT pw_songwriting_trainings_date_in_month
      CHECK (training_date IS NULL
             OR (extract(year FROM training_date) = year
                 AND extract(month FROM training_date) = month));
  END IF;
END $$;

COMMENT ON COLUMN public.pw_songwriting_trainings.training_date IS
  'Optional day of the training (a date: clients send YYYY-MM-DD, never a timestamp). Must fall in year/month, which stay required and remain the grouping key. Null = month only (all imported rows).';

-- ────────────────────────────────────────────────────────────
-- 3. Leads
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.pw_songwriting_leads (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- What the card shows: a person's name, an organisation or a group.
  label               text NOT NULL CHECK (btrim(label) <> ''),
  kind                text NOT NULL DEFAULT 'person'
    CHECK (kind IN ('person', 'organisation', 'group')),
  -- Hub user, when the lead has an account. label is always kept.
  contact_user_id     uuid REFERENCES public.users (id) ON DELETE SET NULL,
  source_training_id  uuid REFERENCES public.pw_songwriting_trainings (id) ON DELETE SET NULL,
  nation_id           uuid REFERENCES public.pw_nations (id) ON DELETE RESTRICT,
  note                text,
  -- Who on the team follows up. Null = unassigned.
  owner_user_id       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'to_contact', 'waiting', 'connected', 'closed')),
  last_contact_at     timestamptz,
  created_by          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pw_songwriting_leads_status_idx ON public.pw_songwriting_leads (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS pw_songwriting_leads_nation_id_idx ON public.pw_songwriting_leads (nation_id);
CREATE INDEX IF NOT EXISTS pw_songwriting_leads_source_training_id_idx ON public.pw_songwriting_leads (source_training_id);
CREATE INDEX IF NOT EXISTS pw_songwriting_leads_contact_user_id_idx ON public.pw_songwriting_leads (contact_user_id);
CREATE INDEX IF NOT EXISTS pw_songwriting_leads_owner_user_id_idx ON public.pw_songwriting_leads (owner_user_id);
CREATE INDEX IF NOT EXISTS pw_songwriting_leads_created_by_idx ON public.pw_songwriting_leads (created_by);

COMMENT ON TABLE public.pw_songwriting_leads IS
  'People, organisations or groups P&W songwriting follows up with, by nation and/or source training. No contact details: those live in the CRM.';
COMMENT ON COLUMN public.pw_songwriting_leads.contact_user_id IS
  'Hub user, when the lead has an account. label is always kept (most leads have no account).';
COMMENT ON COLUMN public.pw_songwriting_leads.last_contact_at IS
  'Derived: latest pw_songwriting_lead_events.at. Moved forward on event insert, recomputed when an event is deleted or edited. Signed-in callers cannot set it.';
COMMENT ON COLUMN public.pw_songwriting_leads.created_by IS
  'Who added the lead. Set to auth.uid() for signed-in callers on insert; cannot change afterwards.';

CREATE TABLE IF NOT EXISTS public.pw_songwriting_lead_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES public.pw_songwriting_leads (id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  by          uuid REFERENCES public.users (id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pw_songwriting_lead_events_lead_at_idx ON public.pw_songwriting_lead_events (lead_id, at DESC);
CREATE INDEX IF NOT EXISTS pw_songwriting_lead_events_by_idx ON public.pw_songwriting_lead_events (by);

COMMENT ON TABLE public.pw_songwriting_lead_events IS
  'One logged contact with a lead ("Log contact"). by = the Hub user who logged it.';

COMMENT ON COLUMN public.pw_songwriting_lead_events.by IS
  'Who logged the contact. auth.uid() for signed-in callers (whatever was sent); service_role must name one. Null only after that user is deleted.';

-- ── 3a. Actor stamping and the derived last_contact_at ──
-- SECURITY INVOKER (like 416's guards) so current_user tells signed-in
-- callers (authenticated / anon) from service_role and the owner. The
-- owner covers FK actions (a user delete nulls by / created_by) and the
-- DEFINER maintenance function below.

CREATE OR REPLACE FUNCTION public.pw_songwriting_leads_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    IF NEW.last_contact_at IS NOT NULL THEN
      RAISE EXCEPTION 'pw_lead_last_contact_derived'
        USING ERRCODE = '42501',
              DETAIL = 'last_contact_at comes from logged contacts. Log a contact instead.';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'pw_songwriting_actor_locked'
      USING ERRCODE = '42501', DETAIL = 'created_by cannot change.';
  END IF;
  IF NEW.last_contact_at IS DISTINCT FROM OLD.last_contact_at THEN
    RAISE EXCEPTION 'pw_lead_last_contact_derived'
      USING ERRCODE = '42501',
            DETAIL = 'last_contact_at comes from logged contacts. Log a contact instead.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pw_songwriting_leads_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pw_songwriting_leads_guard ON public.pw_songwriting_leads;
CREATE TRIGGER pw_songwriting_leads_guard
  BEFORE INSERT OR UPDATE ON public.pw_songwriting_leads
  FOR EACH ROW EXECUTE FUNCTION public.pw_songwriting_leads_guard();

-- Events: signed-in callers can only INSERT (UPDATE has no grant or
-- policy), so this stamps by on insert. The UPDATE branch is defence in
-- depth should an UPDATE grant ever come back.
CREATE OR REPLACE FUNCTION public.pw_songwriting_lead_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW."by" := auth.uid();
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'pw_songwriting_actor_locked'
      USING ERRCODE = '42501', DETAIL = 'Logged contacts are append-only.';
  END IF;
  IF current_user = 'service_role' AND NEW."by" IS NULL THEN
    RAISE EXCEPTION 'pw_lead_event_actor_required'
      USING ERRCODE = '23514', DETAIL = 'A logged contact needs by (the Hub user who made it).';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pw_songwriting_lead_events_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pw_songwriting_lead_events_guard ON public.pw_songwriting_lead_events;
CREATE TRIGGER pw_songwriting_lead_events_guard
  BEFORE INSERT OR UPDATE ON public.pw_songwriting_lead_events
  FOR EACH ROW EXECUTE FUNCTION public.pw_songwriting_lead_events_guard();

-- last_contact_at maintenance. SECURITY DEFINER on purpose: it is the
-- only writer of last_contact_at, so it must run as the owner, past the
-- guard above. It only touches the lead of the event row the caller just
-- inserted / deleted (RLS already allowed that), and only that column.
--   INSERT: move forward to NEW.at (never back).
--   DELETE / UPDATE (service_role): recompute max(at) of the remaining
--   events for the old and new lead (null when none are left).
CREATE OR REPLACE FUNCTION public.pw_songwriting_lead_events_touch_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.pw_songwriting_leads l
       SET last_contact_at = NEW.at
     WHERE l.id = NEW.lead_id
       AND (l.last_contact_at IS NULL OR l.last_contact_at < NEW.at);
    RETURN NULL;
  END IF;

  UPDATE public.pw_songwriting_leads l
     SET last_contact_at = (SELECT max(e.at) FROM public.pw_songwriting_lead_events e WHERE e.lead_id = l.id)
   WHERE l.id = OLD.lead_id
      OR (TG_OP = 'UPDATE' AND l.id = NEW.lead_id);
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.pw_songwriting_lead_events_touch_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pw_songwriting_lead_events_touch_lead ON public.pw_songwriting_lead_events;
CREATE TRIGGER pw_songwriting_lead_events_touch_lead
  AFTER INSERT OR DELETE OR UPDATE OF lead_id, at ON public.pw_songwriting_lead_events
  FOR EACH ROW EXECUTE FUNCTION public.pw_songwriting_lead_events_touch_lead();

-- Who may delete a logged contact: the author, or an admin (with
-- songwriting access). Same helper shape as 417.
CREATE OR REPLACE FUNCTION public.pw_can_delete_lead_event(p_by uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.pw_can_access_songwriting()
     AND (public.is_admin() OR (p_by IS NOT NULL AND p_by = auth.uid()));
$$;

REVOKE ALL ON FUNCTION public.pw_can_delete_lead_event(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pw_can_delete_lead_event(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- 4. Triggers, grants, RLS
-- ────────────────────────────────────────────────────────────
-- Leads: exactly 417's (read / insert / update / delete = songwriting
-- access). Who may read or write leads is unchanged from 417 on purpose.
-- Events: read and insert = songwriting access; no UPDATE grant or policy
-- for signed-in callers (append-only); delete = author or admin.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pw_songwriting_leads', 'pw_songwriting_lead_events'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON public.%I', t);
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at()', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting reads" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting reads" ON public.%I FOR SELECT TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting inserts" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting inserts" ON public.%I FOR INSERT TO authenticated
         WITH CHECK ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting updates" ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting deletes" ON public.%I', t);
  END LOOP;
END
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pw_songwriting_leads TO authenticated;
CREATE POLICY "P&W songwriting updates" ON public.pw_songwriting_leads FOR UPDATE TO authenticated
  USING ((SELECT public.pw_can_access_songwriting()))
  WITH CHECK ((SELECT public.pw_can_access_songwriting()));
CREATE POLICY "P&W songwriting deletes" ON public.pw_songwriting_leads FOR DELETE TO authenticated
  USING ((SELECT public.pw_can_access_songwriting()));

REVOKE UPDATE ON public.pw_songwriting_lead_events FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.pw_songwriting_lead_events TO authenticated;
CREATE POLICY "P&W songwriting deletes" ON public.pw_songwriting_lead_events FOR DELETE TO authenticated
  USING ((SELECT public.pw_can_delete_lead_event(by)));
