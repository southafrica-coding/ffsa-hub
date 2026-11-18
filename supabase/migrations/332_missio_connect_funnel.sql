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
-- Every connect card, including a service-role insert, creates
-- or attaches to a follow-up. Joining a house does not create a
-- follow-up. The joined trigger only moves an existing one to
-- joined. Leader access to assigned follow-ups is a later change.
-- This file does not grant it.
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
  -- Raw phone stays in phone. phone_e164 is the parsed form, or
  -- null when the number cannot be parsed. Filled by the trigger
  -- below, not by the caller.
  phone_e164          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.connect_responses
  ADD COLUMN IF NOT EXISTS phone_e164 text;

CREATE INDEX IF NOT EXISTS connect_responses_org_submitted_idx
  ON public.connect_responses (org_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS connect_responses_matched_contact_idx
  ON public.connect_responses (matched_contact_id);

CREATE INDEX IF NOT EXISTS connect_responses_rate_key_created_idx
  ON public.connect_responses (rate_key_hash, created_at);

CREATE INDEX IF NOT EXISTS connect_responses_org_phone_e164_idx
  ON public.connect_responses (org_id, phone_e164);

COMMENT ON TABLE public.connect_responses IS
  'A Missio connect card. Public QR and PCO rows are inserted by the service role. Pastors may insert only source manual, and may update. No delete policy.';

COMMENT ON COLUMN public.connect_responses.visit_type IS
  'first_time, been_a_while, or regular.';

COMMENT ON COLUMN public.connect_responses.rate_key_hash IS
  'HMAC of an IP or a device id, written by the API for rate limiting. Never a raw IP.';

COMMENT ON COLUMN public.connect_responses.source IS
  'qr, manual, or pco. Authenticated insert is limited to manual. qr and pco are service-role only.';

COMMENT ON COLUMN public.connect_responses.phone IS
  'The phone number as the person entered it. Not rewritten.';

COMMENT ON COLUMN public.connect_responses.phone_e164 IS
  'E.164 form of phone. South Africa is the default country. Null when the number cannot be parsed. Set by trigger, not by the caller.';

-- Migration 068 does not expose a normalizer. It stores
-- contact_phones.phone_normalized, filled by the application with
-- libphonenumber-js, and checks the shape ^\+[1-9][0-9]{6,14}$.
-- The steps below are src/lib/phone.ts normalizePhoneE164, default
-- region ZA. Postgres has no libphonenumber, so a candidate is
-- accepted when it matches that 068 shape and a length that
-- function treats as a real number: a ZA national number of 9
-- digits, a NANP number of 10 digits, or any other already-typed
-- E.164 that is not a broken ZA number. Private: revoked from
-- anon and authenticated. The trigger below is the caller.
CREATE OR REPLACE FUNCTION public.missio_phone_e164(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  trimmed text;
  had_plus boolean;
  digits text;
  parsed text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  trimmed := btrim(raw);
  IF trimmed = '' THEN
    RETURN NULL;
  END IF;

  parsed := public.missio_phone_e164_try(trimmed);
  IF parsed IS NOT NULL THEN
    RETURN parsed;
  END IF;

  had_plus := left(trimmed, 1) = '+';
  digits := regexp_replace(regexp_replace(trimmed, '^\+', ''), '\D', '', 'g');
  IF length(digits) < 7 OR length(digits) > 15 THEN
    RETURN NULL;
  END IF;
  -- A rejected + number is not guessed into another country.
  IF had_plus THEN
    RETURN NULL;
  END IF;

  -- Prepend +. "27821234567" and "16162187556".
  parsed := public.missio_phone_e164_try('+' || digits);
  IF parsed IS NOT NULL THEN
    RETURN parsed;
  END IF;

  -- HubSpot-style country code plus a 0-prefixed local number.
  IF left(digits, 2) = '27' AND substr(digits, 3, 1) = '0' AND length(digits) >= 11 THEN
    parsed := public.missio_phone_e164_try('+27' || substr(digits, 4));
    IF parsed IS NOT NULL THEN
      RETURN parsed;
    END IF;
  END IF;
  IF left(digits, 1) = '1' AND substr(digits, 2, 1) = '0' AND length(digits) >= 11 THEN
    parsed := public.missio_phone_e164_try('+1' || substr(digits, 3));
    IF parsed IS NOT NULL THEN
      RETURN parsed;
    END IF;
  END IF;
  IF left(digits, 2) IN ('44', '61', '64')
     AND substr(digits, 3, 1) = '0'
     AND length(digits) >= 12 THEN
    parsed := public.missio_phone_e164_try('+' || left(digits, 2) || substr(digits, 4));
    IF parsed IS NOT NULL THEN
      RETURN parsed;
    END IF;
  END IF;

  -- Local number in ZA, leading zeros stripped.
  digits := regexp_replace(digits, '^0+', '');
  IF length(digits) >= 7 THEN
    parsed := public.missio_phone_e164_try(digits);
    IF parsed IS NOT NULL THEN
      RETURN parsed;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- The acceptance step of normalizePhoneE164. Not granted to callers.
CREATE OR REPLACE FUNCTION public.missio_phone_e164_try(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  digits text;
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN NULL;
  END IF;

  IF left(btrim(input), 1) = '+' THEN
    digits := regexp_replace(substr(btrim(input), 2), '\D', '', 'g');
    IF digits !~ '^[1-9][0-9]{6,14}$' THEN
      RETURN NULL;
    END IF;
    -- ZA national number is 9 digits: +27 and 11 digits total.
    IF left(digits, 2) = '27' THEN
      IF length(digits) = 11 THEN
        RETURN '+' || digits;
      END IF;
      RETURN NULL;
    END IF;
    -- NANP, the other length the app function documents.
    IF left(digits, 1) = '1' AND length(digits) = 11 THEN
      RETURN '+' || digits;
    END IF;
    IF length(digits) BETWEEN 8 AND 15 THEN
      RETURN '+' || digits;
    END IF;
    RETURN NULL;
  END IF;

  digits := regexp_replace(input, '\D', '', 'g');
  -- ZA local with a leading 0: 10 digits.
  IF digits ~ '^0[1-9][0-9]{8}$' THEN
    RETURN '+27' || substr(digits, 2);
  END IF;
  -- ZA local without the leading 0: 9 digits.
  IF digits ~ '^[1-9][0-9]{8}$' THEN
    RETURN '+27' || digits;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.missio_phone_e164(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.missio_phone_e164_try(text) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.missio_phone_e164(text) IS
  'Private. Copies src/lib/phone.ts normalizePhoneE164 (default ZA), which is what migration 068 stores in phone_normalized. There is no SQL function in 068. Returns null when the number cannot be parsed. phone itself is left unchanged.';

CREATE OR REPLACE FUNCTION public.set_connect_response_phone_e164()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.phone_e164 := public.missio_phone_e164(NEW.phone);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_connect_response_phone_e164() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_connect_response_phone_e164 ON public.connect_responses;
CREATE TRIGGER trg_connect_response_phone_e164
  BEFORE INSERT OR UPDATE OF phone ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_connect_response_phone_e164();

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

-- One open follow-up per contact in an org. Open means stage is
-- not joined, so a person who has joined can start another from a
-- later card. Replacing the index (not IF NOT EXISTS) so a re-run
-- picks up the predicate. A row with a null contact_id is outside
-- this index: the number lives on the card, and the attach trigger
-- matches those by phone_e164. Two open card-only rows can exist
-- only when phone_e164 is null, because then there is no key to
-- match on.
DROP INDEX IF EXISTS public.missio_followups_org_contact_uidx;
CREATE UNIQUE INDEX missio_followups_org_contact_uidx
  ON public.missio_followups (org_id, contact_id)
  WHERE contact_id IS NOT NULL AND stage <> 'joined';

CREATE UNIQUE INDEX IF NOT EXISTS missio_followups_connect_response_uidx
  ON public.missio_followups (connect_response_id)
  WHERE connect_response_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS missio_followups_org_id_idx
  ON public.missio_followups (org_id);

COMMENT ON TABLE public.missio_followups IS
  'A Missio follow-up. A connect card creates one, or attaches to the open one. A house membership does not create one. Pastors may select, insert and update. Delete is service-role only. At most one open row (stage <> joined) per contact in an org.';

COMMENT ON COLUMN public.missio_followups.assigned_leader_contact_id IS
  'The main assignee, a contact. assigned_user_id is an optional hub user. Leader and co-leader access to the follow-ups assigned to them is a later change. This migration does not grant it. Access stays pastors-only.';

COMMENT ON COLUMN public.missio_followups.assigned_user_id IS
  'Optional hub user. The main assignee is assigned_leader_contact_id. Leader access is a later change. Access stays pastors-only.';

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
  kind         text NOT NULL DEFAULT 'stage_change',
  connect_response_id uuid REFERENCES public.connect_responses (id) ON DELETE SET NULL,
  CONSTRAINT missio_followup_stage_history_kind_check
    CHECK (kind IN ('stage_change', 'note', 'connect_card')),
  CONSTRAINT missio_followup_stage_history_shape_check
    CHECK (
      (kind = 'stage_change' AND to_stage IS NOT NULL)
      OR (kind = 'note' AND notes IS NOT NULL AND from_stage IS NULL AND to_stage IS NULL)
      OR (kind = 'connect_card' AND connect_response_id IS NOT NULL)
    )
);

ALTER TABLE public.missio_followup_stage_history
  ADD COLUMN IF NOT EXISTS connect_response_id uuid REFERENCES public.connect_responses (id) ON DELETE SET NULL;

ALTER TABLE public.missio_followup_stage_history
  DROP CONSTRAINT IF EXISTS missio_followup_stage_history_kind_check;
ALTER TABLE public.missio_followup_stage_history
  DROP CONSTRAINT IF EXISTS missio_followup_stage_history_shape_check;
ALTER TABLE public.missio_followup_stage_history
  ADD CONSTRAINT missio_followup_stage_history_kind_check
  CHECK (kind IN ('stage_change', 'note', 'connect_card'));
ALTER TABLE public.missio_followup_stage_history
  ADD CONSTRAINT missio_followup_stage_history_shape_check
  CHECK (
    (kind = 'stage_change' AND to_stage IS NOT NULL)
    OR (kind = 'note' AND notes IS NOT NULL AND from_stage IS NULL AND to_stage IS NULL)
    OR (kind = 'connect_card' AND connect_response_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS missio_followup_stage_history_followup_idx
  ON public.missio_followup_stage_history (followup_id, changed_at);

COMMENT ON TABLE public.missio_followup_stage_history IS
  'Timeline for a follow-up. kind stage_change is written by the stage trigger. kind connect_card is written when a card is attached. kind note is a pastor inserting a note, or the duplicate-match note. No update and no delete for authenticated. Pastors may insert only kind note.';

COMMENT ON COLUMN public.missio_followup_stage_history.kind IS
  'stage_change, note, or connect_card. stage_change requires to_stage. note requires notes. connect_card requires connect_response_id.';

COMMENT ON COLUMN public.missio_followup_stage_history.connect_response_id IS
  'The card a connect_card timeline row is about. Null on stage changes and notes.';

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
  IF NEW.ended_at IS NOT NULL THEN
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
  'When a current Missio house membership is written, set that contact''s existing missio_followups.stage to joined. Current means ended_at IS NULL and started_at <= today. Does not insert a follow-up. Does not change org_people. A membership that has already ended is ignored.';

DROP TRIGGER IF EXISTS trg_house_church_member_mark_joined ON public.house_church_members;
CREATE TRIGGER trg_house_church_member_mark_joined
  AFTER INSERT OR UPDATE ON public.house_church_members
  FOR EACH ROW EXECUTE FUNCTION public.mark_missio_followup_joined();

-- Every role. A contact pointer must be null or an org_people row
-- in the same org. Service role bypasses the policies, not this.
CREATE OR REPLACE FUNCTION public.guard_missio_connect_contact()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact uuid;
  v_leader uuid;
  v_match_changed boolean;
  v_at_changed boolean;
BEGIN
  IF TG_TABLE_NAME = 'connect_responses' THEN
    v_contact := NEW.matched_contact_id;
    IF TG_OP = 'INSERT' THEN
      v_match_changed := NEW.matched_contact_id IS NOT NULL;
      v_at_changed := NEW.matched_at IS NOT NULL;
    ELSE
      v_match_changed := NEW.matched_contact_id IS DISTINCT FROM OLD.matched_contact_id;
      v_at_changed := NEW.matched_at IS DISTINCT FROM OLD.matched_at;
    END IF;
  ELSE
    v_contact := NEW.contact_id;
    v_leader := NEW.assigned_leader_contact_id;
  END IF;

  IF v_contact IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.org_people op
    WHERE op.org_id = NEW.org_id AND op.contact_id = v_contact
  ) THEN
    RAISE EXCEPTION 'missio_contact_not_in_org'
      USING ERRCODE = '23503';
  END IF;

  IF TG_TABLE_NAME = 'missio_followups'
     AND v_leader IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.org_people op
       WHERE op.org_id = NEW.org_id AND op.contact_id = v_leader
     ) THEN
    RAISE EXCEPTION 'missio_contact_not_in_org'
      USING ERRCODE = '23503';
  END IF;

  IF TG_TABLE_NAME = 'connect_responses' THEN
    IF auth.uid() IS NOT NULL AND (TG_OP = 'INSERT' OR v_match_changed) THEN
      NEW.matched_by := auth.uid();
    END IF;
    IF v_match_changed OR v_at_changed THEN
      NEW.matched_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_missio_connect_contact() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.guard_missio_connect_contact() IS
  'BEFORE write, every role. 23503 missio_contact_not_in_org when matched_contact_id, contact_id, or assigned_leader_contact_id is set and that contact is not in org_people for the row org. Nulls are allowed. When auth.uid() is set, matched_by is overwritten with it; a null auth.uid() keeps the supplied value. matched_at becomes now() when the match or the timestamp changes.';

DROP TRIGGER IF EXISTS trg_connect_response_guard_contact ON public.connect_responses;
CREATE TRIGGER trg_connect_response_guard_contact
  BEFORE INSERT OR UPDATE OF matched_contact_id, matched_by, matched_at
  ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_missio_connect_contact();

DROP TRIGGER IF EXISTS trg_missio_followup_guard_contact ON public.missio_followups;
CREATE TRIGGER trg_missio_followup_guard_contact
  BEFORE INSERT OR UPDATE OF contact_id, assigned_leader_contact_id, org_id
  ON public.missio_followups
  FOR EACH ROW EXECUTE FUNCTION public.guard_missio_connect_contact();

-- Pins changed_by when a person is signed in. Service role (null
-- auth.uid()) keeps the value the statement supplied.
CREATE OR REPLACE FUNCTION public.pin_missio_followup_changed_by()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.changed_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.pin_missio_followup_changed_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_missio_followup_history_pin_changed_by ON public.missio_followup_stage_history;
CREATE TRIGGER trg_missio_followup_history_pin_changed_by
  BEFORE INSERT OR UPDATE OF changed_by ON public.missio_followup_stage_history
  FOR EACH ROW EXECUTE FUNCTION public.pin_missio_followup_changed_by();

-- AFTER INSERT on a card. Open means stage <> joined. A matched
-- contact attaches to that contact's open follow-up. Otherwise a
-- parsed phone attaches to an open follow-up already linked to a
-- card with the same phone_e164. A null phone_e164 does not match.
-- Creating the follow-up runs the stage trigger, then a connect_card
-- timeline row is written. The contact guard above still applies.
CREATE OR REPLACE FUNCTION public.attach_missio_connect_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_followup uuid;
  v_other uuid;
BEGIN
  IF NEW.matched_contact_id IS NOT NULL THEN
    SELECT f.id INTO v_followup
    FROM public.missio_followups f
    WHERE f.org_id = NEW.org_id
      AND f.contact_id = NEW.matched_contact_id
      AND f.stage <> 'joined'
    ORDER BY f.created_at, f.id
    LIMIT 1;
  ELSIF NEW.phone_e164 IS NOT NULL THEN
    SELECT f.id INTO v_followup
    FROM public.missio_followups f
    WHERE f.org_id = NEW.org_id
      AND f.stage <> 'joined'
      AND EXISTS (
        SELECT 1
        FROM public.connect_responses cr
        WHERE cr.org_id = NEW.org_id
          AND cr.id <> NEW.id
          AND cr.phone_e164 = NEW.phone_e164
          AND (
            cr.id = f.connect_response_id
            OR EXISTS (
              SELECT 1
              FROM public.missio_followup_stage_history h
              WHERE h.followup_id = f.id
                AND h.kind = 'connect_card'
                AND h.connect_response_id = cr.id
            )
          )
      )
    ORDER BY f.created_at, f.id
    LIMIT 1;
  END IF;

  IF v_followup IS NULL THEN
    INSERT INTO public.missio_followups (org_id, contact_id, connect_response_id, stage)
    VALUES (NEW.org_id, NEW.matched_contact_id, NEW.id, 'new')
    RETURNING id INTO v_followup;
  ELSE
    UPDATE public.missio_followups
       SET connect_response_id = NEW.id
     WHERE id = v_followup
       AND connect_response_id IS NULL;
  END IF;

  INSERT INTO public.missio_followup_stage_history (
    followup_id, kind, connect_response_id, changed_by
  ) VALUES (
    v_followup, 'connect_card', NEW.id, auth.uid()
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.attach_missio_connect_response() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.attach_missio_connect_response() IS
  'AFTER INSERT of a connect card, every source. Attaches the card to the open follow-up for that contact or phone, or creates a stage-new follow-up. Does not create a follow-up that the contact guard would reject. Writes a connect_card timeline row.';

DROP TRIGGER IF EXISTS trg_connect_response_attach_followup ON public.connect_responses;
CREATE TRIGGER trg_connect_response_attach_followup
  AFTER INSERT ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.attach_missio_connect_response();

-- A later match. If this card's follow-up has no contact and the
-- contact has no other open follow-up, set it. If another open
-- follow-up already has that contact, leave both rows and write a
-- note on each. Does not merge them.
CREATE OR REPLACE FUNCTION public.link_missio_connect_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_followup uuid;
  v_contact uuid;
  v_other uuid;
BEGIN
  IF NEW.matched_contact_id IS NULL
     OR NEW.matched_contact_id IS NOT DISTINCT FROM OLD.matched_contact_id THEN
    RETURN NEW;
  END IF;

  SELECT f.id, f.contact_id
    INTO v_followup, v_contact
  FROM public.missio_followups f
  WHERE f.org_id = NEW.org_id
    AND (
      f.connect_response_id = NEW.id
      OR EXISTS (
        SELECT 1
        FROM public.missio_followup_stage_history h
        WHERE h.followup_id = f.id
          AND h.kind = 'connect_card'
          AND h.connect_response_id = NEW.id
      )
    )
  ORDER BY (f.connect_response_id = NEW.id) DESC, f.created_at
  LIMIT 1;

  IF v_followup IS NULL OR v_contact IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT f.id INTO v_other
  FROM public.missio_followups f
  WHERE f.org_id = NEW.org_id
    AND f.contact_id = NEW.matched_contact_id
    AND f.stage <> 'joined'
    AND f.id <> v_followup
  LIMIT 1;

  IF v_other IS NULL THEN
    UPDATE public.missio_followups
       SET contact_id = NEW.matched_contact_id
     WHERE id = v_followup
       AND contact_id IS NULL;
    RETURN NEW;
  END IF;

  INSERT INTO public.missio_followup_stage_history (followup_id, kind, notes, changed_by)
  VALUES
    (v_followup, 'note', 'A duplicate needs a manual merge.', auth.uid()),
    (v_other, 'note', 'A duplicate needs a manual merge.', auth.uid());

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.link_missio_connect_match() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.link_missio_connect_match() IS
  'AFTER UPDATE of matched_contact_id. Sets the card follow-up contact when it is empty and the contact has no other open follow-up. Otherwise writes a note on both follow-ups and leaves the rows unmerged.';

DROP TRIGGER IF EXISTS trg_connect_response_link_match ON public.connect_responses;
CREATE TRIGGER trg_connect_response_link_match
  AFTER UPDATE OF matched_contact_id ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.link_missio_connect_match();

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
        AND m.ended_at IS NULL
    ) THEN 'joined'
    ELSE f.stage
  END AS effective_stage
FROM public.missio_followups f;

ALTER VIEW public.missio_followup_effective SET (security_invoker = true);

COMMENT ON VIEW public.missio_followup_effective IS
  'Follow-up rows plus effective_stage. effective_stage is joined while the contact has a current Missio house membership, otherwise the stored stage. security_invoker: RLS applies. Does not write.';

-- ────────────────────────────────────────────────────────────
-- 6. missio_not_in_house
--    People with no current Missio house membership. Contact rows
--    come from Missio org_people, not from the contact label.
--    Contact fields are read only for those org_people rows, and
--    only the name is exposed. A card row may show the phone the
--    person typed and its phone_e164. Email is not in this view.
--    Owner-rights and a security barrier, same pattern as
--    org_people_directory, gated to Missio pastors.
--
--    A card matched to an org_people contact is not a second row.
--    That person is the contact row, with the latest card's id.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.missio_not_in_house
WITH (security_invoker = false, security_barrier = true) AS
WITH missio AS (
  SELECT o.id AS org_id
  FROM public.organisations o
  WHERE o.slug = 'missio'
),
active_member AS (
  SELECT m.contact_id, hc.org_id
  FROM public.house_church_members m
  JOIN public.house_churches hc ON hc.id = m.house_church_id
  JOIN missio mo ON mo.org_id = hc.org_id
  WHERE m.ended_at IS NULL
    AND m.started_at <= current_date
),
people_outside AS (
  SELECT op.org_id, op.contact_id
  FROM public.org_people op
  JOIN missio mo ON mo.org_id = op.org_id
  WHERE NOT EXISTS (
    SELECT 1
    FROM active_member am
    WHERE am.contact_id = op.contact_id
      AND am.org_id = op.org_id
  )
),
contact_rows AS (
  SELECT
    'contact'::text AS source,
    p.contact_id,
    lr.id AS connect_response_id,
    c.first_name,
    c.last_name,
    btrim(c.first_name || ' ' || c.last_name) AS display_name,
    NULL::text AS phone,
    NULL::text AS phone_e164,
    lr.wants_house_church,
    f.stage AS followup_stage,
    lr.submitted_at
  FROM people_outside p
  JOIN public.contacts c ON c.id = p.contact_id
  LEFT JOIN LATERAL (
    SELECT cr.id, cr.wants_house_church, cr.submitted_at
    FROM public.connect_responses cr
    WHERE cr.org_id = p.org_id
      AND cr.matched_contact_id = p.contact_id
    ORDER BY cr.submitted_at DESC, cr.id DESC
    LIMIT 1
  ) lr ON true
  LEFT JOIN LATERAL (
    SELECT fu.stage
    FROM public.missio_followups fu
    WHERE fu.org_id = p.org_id
      AND (
        fu.contact_id = p.contact_id
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
    NULL::text AS first_name,
    NULL::text AS last_name,
    cr.name AS display_name,
    cr.phone,
    cr.phone_e164,
    cr.wants_house_church,
    f.stage AS followup_stage,
    cr.submitted_at
  FROM public.connect_responses cr
  JOIN missio mo ON mo.org_id = cr.org_id
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
      FROM people_outside p
      WHERE p.contact_id = cr.matched_contact_id
        AND p.org_id = cr.org_id
    )
)
SELECT
  people.source,
  people.contact_id,
  people.connect_response_id,
  people.first_name,
  people.last_name,
  people.display_name,
  people.phone,
  people.phone_e164,
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
  'People with no current Missio house membership. Current means ended_at IS NULL and started_at on or before today. Contact rows are Missio org_people and expose first_name, last_name and display_name only. Card rows expose the submitted phone and phone_e164. Email is not in this view. A card matched to an org_people contact is folded into that contact row. Owner-rights, security barrier, pastors only.';

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

GRANT SELECT, INSERT ON TABLE public.connect_responses TO authenticated;
GRANT UPDATE (
  matched_contact_id,
  notes,
  wants_house_church,
  wants_prayer,
  prayer_request,
  service_date
) ON TABLE public.connect_responses TO authenticated;
GRANT SELECT, INSERT ON TABLE public.missio_followups TO authenticated;
GRANT UPDATE (
  stage,
  assigned_leader_contact_id,
  assigned_user_id
) ON TABLE public.missio_followups TO authenticated;
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
    AND (
      matched_contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = org_id AND op.contact_id = matched_contact_id
      )
    )
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
    AND (
      matched_contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = org_id AND op.contact_id = matched_contact_id
      )
    )
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
    AND (
      contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = org_id AND op.contact_id = contact_id
      )
    )
    AND (
      assigned_leader_contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = org_id
          AND op.contact_id = assigned_leader_contact_id
      )
    )
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
    AND (
      contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = org_id AND op.contact_id = contact_id
      )
    )
    AND (
      assigned_leader_contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = org_id
          AND op.contact_id = assigned_leader_contact_id
      )
    )
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
