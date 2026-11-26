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
--                           SongwritingLeadEvent. Inserting one moves the
--                           lead's last_contact_at forward.
-- pw_songs is unchanged (kept thin).
--
-- Access: exactly 417's. Every new table uses
-- pw_can_access_songwriting() (SECURITY DEFINER, search_path '') for
-- read and write: active prayer_and_worship members and admins only;
-- anon has no grants.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, guarded constraints, IF NOT
-- EXISTS tables and indexes, DROP ... IF EXISTS before CREATE.
-- Rollback: supabase/rollbacks/424_pw_songwriting_v2_rollback.sql
-- (run it before 417's rollback).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Nations: iso_code, languages
-- ────────────────────────────────────────────────────────────

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
  -- No null or blank entries. (Duplicates are the API's job, as on trainings.)
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.pw_nations'::regclass
                    AND conname = 'pw_nations_languages_no_blanks') THEN
    ALTER TABLE public.pw_nations
      ADD CONSTRAINT pw_nations_languages_no_blanks
      CHECK (array_position(languages, NULL) IS NULL
             AND array_position(languages, '') IS NULL);
  END IF;
END $$;

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
  'Optional day of the training. Must fall in year/month, which stay required and remain the grouping key. Null = month only (all imported rows).';

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
  'Latest contact. Moved forward by each pw_songwriting_lead_events insert; may also be set directly.';

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

-- A logged contact moves the lead's last_contact_at forward (never back).
-- SECURITY INVOKER: the caller already passed RLS on the event insert and
-- has the same access to the lead row, so no elevated rights are needed.
CREATE OR REPLACE FUNCTION public.pw_songwriting_lead_events_touch_lead()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  UPDATE public.pw_songwriting_leads l
     SET last_contact_at = NEW.at
   WHERE l.id = NEW.lead_id
     AND (l.last_contact_at IS NULL OR l.last_contact_at < NEW.at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pw_songwriting_lead_events_touch_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS pw_songwriting_lead_events_touch_lead ON public.pw_songwriting_lead_events;
CREATE TRIGGER pw_songwriting_lead_events_touch_lead
  AFTER INSERT ON public.pw_songwriting_lead_events
  FOR EACH ROW EXECUTE FUNCTION public.pw_songwriting_lead_events_touch_lead();

-- ────────────────────────────────────────────────────────────
-- 4. Triggers, grants, RLS (same as 417)
-- ────────────────────────────────────────────────────────────

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
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', t);

    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting reads" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting reads" ON public.%I FOR SELECT TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting inserts" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting inserts" ON public.%I FOR INSERT TO authenticated
         WITH CHECK ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting updates" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting updates" ON public.%I FOR UPDATE TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))
         WITH CHECK ((SELECT public.pw_can_access_songwriting()))', t);
    EXECUTE format('DROP POLICY IF EXISTS "P&W songwriting deletes" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "P&W songwriting deletes" ON public.%I FOR DELETE TO authenticated
         USING ((SELECT public.pw_can_access_songwriting()))', t);
  END LOOP;
END
$$;
