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

-- match_status
--   unmatched        no existing contact. A new follow-up is created.
--   pending_confirm  the phone matches an existing contact, stored in
--                    suggested_contact_id. Nothing is written to that
--                    person's follow-up or timeline until a pastor
--                    confirms by setting matched_contact_id.
--   confirmed        matched_contact_id is set. The follow-up and the
--                    connect_card timeline row exist.
ALTER TABLE public.connect_responses
  ADD COLUMN IF NOT EXISTS match_status text NOT NULL DEFAULT 'unmatched';

ALTER TABLE public.connect_responses
  DROP CONSTRAINT IF EXISTS connect_responses_match_status_check;

ALTER TABLE public.connect_responses
  ADD CONSTRAINT connect_responses_match_status_check
  CHECK (match_status IN ('unmatched', 'pending_confirm', 'confirmed'));

ALTER TABLE public.connect_responses
  ADD COLUMN IF NOT EXISTS suggested_contact_id uuid
    REFERENCES public.contacts (id) ON DELETE SET NULL;

-- The three states are exclusive. Callers do not write them;
-- assign_missio_connect_match does, on every role.
ALTER TABLE public.connect_responses
  DROP CONSTRAINT IF EXISTS connect_responses_pending_confirm_check;

ALTER TABLE public.connect_responses
  ADD CONSTRAINT connect_responses_pending_confirm_check
  CHECK (
    match_status <> 'pending_confirm'
    OR (suggested_contact_id IS NOT NULL AND matched_contact_id IS NULL)
  );

ALTER TABLE public.connect_responses
  DROP CONSTRAINT IF EXISTS connect_responses_confirmed_check;

ALTER TABLE public.connect_responses
  ADD CONSTRAINT connect_responses_confirmed_check
  CHECK (match_status <> 'confirmed' OR matched_contact_id IS NOT NULL);

ALTER TABLE public.connect_responses
  DROP CONSTRAINT IF EXISTS connect_responses_unmatched_check;

ALTER TABLE public.connect_responses
  ADD CONSTRAINT connect_responses_unmatched_check
  CHECK (match_status <> 'unmatched' OR matched_contact_id IS NULL);

COMMENT ON COLUMN public.connect_responses.match_status IS
  'unmatched: no contact, a new follow-up is created. pending_confirm: phone matched an existing contact (suggested_contact_id) and nothing was attached. confirmed: a pastor set matched_contact_id and the follow-up plus connect_card timeline row exist.';

COMMENT ON COLUMN public.connect_responses.suggested_contact_id IS
  'The contact a phone match points at. Set only for pending_confirm. Confirming copies the pastor''s choice into matched_contact_id; this column is the suggestion, not the link.';

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
-- contact_phones.phone_normalized, filled by src/lib/phone.ts
-- normalizePhoneE164 (default region ZA) via libphonenumber-js.
-- This copies that control flow: try the text as typed, then a
-- leading +, then a country code glued to a trunk 0, then the
-- digits with leading zeros stripped as a ZA local number.
-- A candidate is kept only when libphonenumber would call it
-- valid: a known calling code, a national length that code
-- allows, and for South Africa the national pattern. An extension
-- (ext, extension, x, #) is dropped first. A leading 00 is the
-- ZA international prefix. Unknown codes such as +999 are null.
-- Private: revoked from anon and authenticated.
-- The same three digit ranges libphonenumber-js folds: fullwidth,
-- Arabic-Indic, and Eastern Arabic. Devanagari and other digits
-- are left alone, so a number made of them parses as null.
CREATE OR REPLACE FUNCTION public.missio_fold_phone_digits(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT translate(
    input,
    chr(1632) || chr(1633) || chr(1634) || chr(1635) || chr(1636)
      || chr(1637) || chr(1638) || chr(1639) || chr(1640) || chr(1641)
      || chr(1776) || chr(1777) || chr(1778) || chr(1779) || chr(1780)
      || chr(1781) || chr(1782) || chr(1783) || chr(1784) || chr(1785)
      || chr(65296) || chr(65297) || chr(65298) || chr(65299) || chr(65300)
      || chr(65301) || chr(65302) || chr(65303) || chr(65304) || chr(65305),
    '012345678901234567890123456789'
  );
$fn$;

REVOKE ALL ON FUNCTION public.missio_fold_phone_digits(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.missio_phone_e164_try(input text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  compact text;
  digits text;
  cc text;
  national text;
  stripped text;
  lens int[];
BEGIN
  IF input IS NULL OR btrim(input) = '' THEN
    RETURN NULL;
  END IF;
  compact := public.missio_fold_phone_digits(btrim(input));
  -- ";ext=9" is the RFC 3966 form. "ext. 9" and "x9" are the text form.
  compact := regexp_replace(
    compact,
    ';[[:space:]]*ext[[:space:]]*=[[:space:]]*[0-9]+;?',
    '',
    'gi'
  );
  compact := regexp_replace(
    compact,
    '[[:space:]]*(ext(ension)?\.?|x|#)[[:space:]]*=?[[:space:]]*[0-9]+[[:space:]]*$',
    '',
    'i'
  );
  IF left(compact, 1) = '+' THEN
    compact := '+' || regexp_replace(substr(compact, 2), '[^0-9]', '', 'g');
  ELSE
    compact := regexp_replace(compact, '[^0-9]', '', 'g');
  END IF;
  IF compact = '' OR compact = '+' THEN
    RETURN NULL;
  END IF;
  IF left(compact, 2) = '00' THEN
    compact := '+' || substr(compact, 3);
    WHILE left(compact, 2) = '+0' LOOP
      compact := '+' || substr(compact, 3);
    END LOOP;
  END IF;

  IF left(compact, 1) = '+' THEN
    digits := substr(compact, 2);
    IF digits !~ '^[1-9][0-9]{6,14}$' THEN
      RETURN NULL;
    END IF;
    SELECT v.code, v.lens INTO cc, lens
    FROM (
      VALUES
      ('211', ARRAY[9]::int[]),
      ('212', ARRAY[9]::int[]),
      ('213', ARRAY[8,9]::int[]),
      ('216', ARRAY[8]::int[]),
      ('218', ARRAY[9]::int[]),
      ('220', ARRAY[7,9]::int[]),
      ('221', ARRAY[9]::int[]),
      ('222', ARRAY[8]::int[]),
      ('223', ARRAY[8]::int[]),
      ('224', ARRAY[8,9]::int[]),
      ('225', ARRAY[10]::int[]),
      ('226', ARRAY[8]::int[]),
      ('227', ARRAY[8]::int[]),
      ('228', ARRAY[8]::int[]),
      ('229', ARRAY[10]::int[]),
      ('230', ARRAY[7,8,10]::int[]),
      ('231', ARRAY[7,8,9]::int[]),
      ('232', ARRAY[8]::int[]),
      ('233', ARRAY[8,9]::int[]),
      ('234', ARRAY[10,11,12,13,14]::int[]),
      ('235', ARRAY[8]::int[]),
      ('236', ARRAY[8]::int[]),
      ('237', ARRAY[8,9]::int[]),
      ('238', ARRAY[7]::int[]),
      ('239', ARRAY[7]::int[]),
      ('240', ARRAY[9]::int[]),
      ('241', ARRAY[7,8]::int[]),
      ('242', ARRAY[9]::int[]),
      ('243', ARRAY[7,8,9,10]::int[]),
      ('244', ARRAY[9]::int[]),
      ('245', ARRAY[7,9]::int[]),
      ('246', ARRAY[7]::int[]),
      ('247', ARRAY[5,6]::int[]),
      ('248', ARRAY[7]::int[]),
      ('249', ARRAY[9]::int[]),
      ('250', ARRAY[8,9]::int[]),
      ('251', ARRAY[9]::int[]),
      ('252', ARRAY[6,7,8,9]::int[]),
      ('253', ARRAY[8]::int[]),
      ('254', ARRAY[7,8,9,10]::int[]),
      ('255', ARRAY[9]::int[]),
      ('256', ARRAY[9]::int[]),
      ('257', ARRAY[8]::int[]),
      ('258', ARRAY[8,9]::int[]),
      ('260', ARRAY[9]::int[]),
      ('261', ARRAY[9]::int[]),
      ('262', ARRAY[9]::int[]),
      ('263', ARRAY[7,9,10]::int[]),
      ('264', ARRAY[8,9]::int[]),
      ('265', ARRAY[7,9]::int[]),
      ('266', ARRAY[8]::int[]),
      ('267', ARRAY[7,8,10]::int[]),
      ('268', ARRAY[8,9]::int[]),
      ('269', ARRAY[7]::int[]),
      ('290', ARRAY[4,5]::int[]),
      ('291', ARRAY[7]::int[]),
      ('297', ARRAY[7]::int[]),
      ('298', ARRAY[6]::int[]),
      ('299', ARRAY[6]::int[]),
      ('350', ARRAY[8]::int[]),
      ('351', ARRAY[9]::int[]),
      ('352', ARRAY[4,5,6,7,8,9,10,11]::int[]),
      ('353', ARRAY[7,8,9,10]::int[]),
      ('354', ARRAY[7,9]::int[]),
      ('355', ARRAY[6,7,8,9]::int[]),
      ('356', ARRAY[8]::int[]),
      ('357', ARRAY[8]::int[]),
      ('358', ARRAY[5,6,7,8,9,10,11,12]::int[]),
      ('359', ARRAY[6,7,8,9,12]::int[]),
      ('370', ARRAY[8]::int[]),
      ('371', ARRAY[8]::int[]),
      ('372', ARRAY[7,8,10]::int[]),
      ('373', ARRAY[8]::int[]),
      ('374', ARRAY[8]::int[]),
      ('375', ARRAY[6,7,8,9,10,11]::int[]),
      ('376', ARRAY[6,8,9]::int[]),
      ('377', ARRAY[8,9]::int[]),
      ('378', ARRAY[8,10]::int[]),
      ('380', ARRAY[9,10]::int[]),
      ('381', ARRAY[6,7,8,9,10,11,12]::int[]),
      ('382', ARRAY[8,9]::int[]),
      ('383', ARRAY[8,9,10,11,12]::int[]),
      ('385', ARRAY[7,8,9]::int[]),
      ('386', ARRAY[5,6,7,8]::int[]),
      ('387', ARRAY[8,9]::int[]),
      ('389', ARRAY[8]::int[]),
      ('420', ARRAY[9,10,11,12]::int[]),
      ('421', ARRAY[6,7,9]::int[]),
      ('423', ARRAY[7,9]::int[]),
      ('500', ARRAY[5]::int[]),
      ('501', ARRAY[7,11]::int[]),
      ('502', ARRAY[8,11]::int[]),
      ('503', ARRAY[7,8,11]::int[]),
      ('504', ARRAY[8,11]::int[]),
      ('505', ARRAY[8]::int[]),
      ('506', ARRAY[8,10]::int[]),
      ('507', ARRAY[7,8,10,11]::int[]),
      ('508', ARRAY[6,9]::int[]),
      ('509', ARRAY[8]::int[]),
      ('590', ARRAY[9]::int[]),
      ('591', ARRAY[8,9]::int[]),
      ('592', ARRAY[7]::int[]),
      ('593', ARRAY[8,9,10,11]::int[]),
      ('594', ARRAY[9]::int[]),
      ('595', ARRAY[6,7,8,9,10,11]::int[]),
      ('596', ARRAY[9]::int[]),
      ('597', ARRAY[6,7]::int[]),
      ('598', ARRAY[4,5,6,7,8,9,10,11,12,13]::int[]),
      ('599', ARRAY[7,8]::int[]),
      ('670', ARRAY[7,8]::int[]),
      ('672', ARRAY[6]::int[]),
      ('673', ARRAY[7]::int[]),
      ('674', ARRAY[7]::int[]),
      ('675', ARRAY[7,8]::int[]),
      ('676', ARRAY[5,7]::int[]),
      ('677', ARRAY[5,7]::int[]),
      ('678', ARRAY[5,7]::int[]),
      ('679', ARRAY[7,11]::int[]),
      ('680', ARRAY[7]::int[]),
      ('681', ARRAY[6,9]::int[]),
      ('682', ARRAY[5]::int[]),
      ('683', ARRAY[4,7]::int[]),
      ('685', ARRAY[5,6,7,10]::int[]),
      ('686', ARRAY[5,8]::int[]),
      ('687', ARRAY[6]::int[]),
      ('688', ARRAY[5,6,7]::int[]),
      ('689', ARRAY[6,8,9]::int[]),
      ('690', ARRAY[4,5,6,7]::int[]),
      ('691', ARRAY[7]::int[]),
      ('692', ARRAY[7]::int[]),
      ('800', ARRAY[8]::int[]),
      ('808', ARRAY[8]::int[]),
      ('850', ARRAY[8,10]::int[]),
      ('852', ARRAY[5,6,7,8,9,11]::int[]),
      ('853', ARRAY[7,8]::int[]),
      ('855', ARRAY[8,9,10]::int[]),
      ('856', ARRAY[8,9,10]::int[]),
      ('870', ARRAY[9,12]::int[]),
      ('878', ARRAY[12]::int[]),
      ('880', ARRAY[6,7,8,9,10]::int[]),
      ('881', ARRAY[9,10]::int[]),
      ('882', ARRAY[7,8,9,10,11,12]::int[]),
      ('883', ARRAY[8,9,10,11,12]::int[]),
      ('886', ARRAY[7,8,9,10,11]::int[]),
      ('888', ARRAY[11]::int[]),
      ('960', ARRAY[7,10]::int[]),
      ('961', ARRAY[7,8]::int[]),
      ('962', ARRAY[8,9]::int[]),
      ('963', ARRAY[8,9]::int[]),
      ('964', ARRAY[8,9,10]::int[]),
      ('965', ARRAY[7,8]::int[]),
      ('966', ARRAY[9,10]::int[]),
      ('967', ARRAY[7,8,9]::int[]),
      ('968', ARRAY[7,8,9]::int[]),
      ('970', ARRAY[8,9,10]::int[]),
      ('971', ARRAY[5,6,7,8,9,10,11,12]::int[]),
      ('972', ARRAY[7,8,9,10,11,12]::int[]),
      ('973', ARRAY[8]::int[]),
      ('974', ARRAY[7,8,9,11]::int[]),
      ('975', ARRAY[7,8]::int[]),
      ('976', ARRAY[8,9,10]::int[]),
      ('977', ARRAY[8,10,11]::int[]),
      ('979', ARRAY[9]::int[]),
      ('992', ARRAY[9]::int[]),
      ('993', ARRAY[8]::int[]),
      ('994', ARRAY[9]::int[]),
      ('995', ARRAY[9]::int[]),
      ('996', ARRAY[9,10]::int[]),
      ('998', ARRAY[9]::int[]),
      ('20', ARRAY[8,9,10]::int[]),
      ('27', ARRAY[5,6,7,8,9,10]::int[]),
      ('30', ARRAY[10,11,12]::int[]),
      ('31', ARRAY[5,6,7,8,9,10,11]::int[]),
      ('32', ARRAY[8,9]::int[]),
      ('33', ARRAY[9]::int[]),
      ('34', ARRAY[9]::int[]),
      ('36', ARRAY[8,9]::int[]),
      ('39', ARRAY[6,7,8,9,10,11,12]::int[]),
      ('40', ARRAY[6,9]::int[]),
      ('41', ARRAY[9,12]::int[]),
      ('43', ARRAY[4,5,6,7,8,9,10,11,12,13]::int[]),
      ('44', ARRAY[7,9,10]::int[]),
      ('45', ARRAY[8]::int[]),
      ('46', ARRAY[6,7,8,9,10,12]::int[]),
      ('47', ARRAY[5,8]::int[]),
      ('48', ARRAY[6,7,8,9,10]::int[]),
      ('49', ARRAY[4,5,6,7,8,9,10,11,12,13,14,15]::int[]),
      ('51', ARRAY[8,9]::int[]),
      ('52', ARRAY[10]::int[]),
      ('53', ARRAY[6,7,8,10]::int[]),
      ('54', ARRAY[10,11]::int[]),
      ('55', ARRAY[8,9,10,11]::int[]),
      ('56', ARRAY[9,10,11]::int[]),
      ('57', ARRAY[8,10,11]::int[]),
      ('58', ARRAY[10]::int[]),
      ('60', ARRAY[8,9,10]::int[]),
      ('61', ARRAY[5,6,7,8,9,10,12]::int[]),
      ('62', ARRAY[7,8,9,10,11,12,13,14,15,16,17]::int[]),
      ('63', ARRAY[6,8,9,10,11,12,13]::int[]),
      ('64', ARRAY[5,6,7,8,9,10]::int[]),
      ('65', ARRAY[8,10,11]::int[]),
      ('66', ARRAY[8,9,10,13]::int[]),
      ('81', ARRAY[8,9,10,11,12,13,14,15,16,17]::int[]),
      ('82', ARRAY[5,6,8,9,10,11,12,13,14]::int[]),
      ('84', ARRAY[7,8,9,10]::int[]),
      ('86', ARRAY[7,8,9,10,11,12]::int[]),
      ('90', ARRAY[7,10,12,13]::int[]),
      ('91', ARRAY[8,9,10,11,12,13]::int[]),
      ('92', ARRAY[8,9,10,11,12]::int[]),
      ('93', ARRAY[9]::int[]),
      ('94', ARRAY[9]::int[]),
      ('95', ARRAY[6,7,8,9,10]::int[]),
      ('98', ARRAY[4,5,6,7,10]::int[]),
      ('1', ARRAY[7,10]::int[]),
      ('7', ARRAY[10,14]::int[])
    ) AS v(code, lens)
    WHERE left(digits, length(v.code)) = v.code
    ORDER BY length(v.code) DESC
    LIMIT 1;
    IF cc IS NULL THEN
      RETURN NULL;
    END IF;
    national := substr(digits, length(cc) + 1);
    stripped := national;
    IF left(national, 1) = '0' THEN
      stripped := substr(national, 2);
    END IF;
    IF cc = '27' THEN
      IF stripped ~ '^([1-79][0-9]{8}|8[0-9]{4,9})$' THEN
        RETURN '+27' || stripped;
      END IF;
      RETURN NULL;
    END IF;
    IF left(national, 1) = '0' AND length(stripped) = ANY (lens) THEN
      RETURN '+' || cc || stripped;
    END IF;
    IF length(national) = ANY (lens) THEN
      RETURN '+' || cc || national;
    END IF;
    RETURN NULL;
  END IF;

  digits := compact;
  IF digits ~ '^0([1-79][0-9]{8}|8[0-9]{4,9})$' THEN
    RETURN '+27' || substr(digits, 2);
  END IF;
  IF digits ~ '^([1-79][0-9]{8}|8[0-9]{4,9})$' THEN
    RETURN '+27' || digits;
  END IF;
  RETURN NULL;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.missio_phone_e164(raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $fn$
DECLARE
  trimmed text;
  had_plus boolean;
  digits text;
  parsed text;
BEGIN
  IF raw IS NULL THEN
    RETURN NULL;
  END IF;
  trimmed := public.missio_fold_phone_digits(btrim(raw));
  IF trimmed = '' THEN
    RETURN NULL;
  END IF;
  -- Drop the extension before the leading-27 fallback below, so
  -- the extension digit is not glued onto the number.
  trimmed := regexp_replace(
    trimmed,
    ';[[:space:]]*ext[[:space:]]*=[[:space:]]*[0-9]+;?',
    '',
    'gi'
  );
  trimmed := regexp_replace(
    trimmed,
    '[[:space:]]*(ext(ension)?\.?|x|#)[[:space:]]*=?[[:space:]]*[0-9]+[[:space:]]*$',
    '',
    'i'
  );
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
  IF had_plus THEN
    RETURN NULL;
  END IF;

  parsed := public.missio_phone_e164_try('+' || digits);
  IF parsed IS NOT NULL THEN
    RETURN parsed;
  END IF;

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

  digits := regexp_replace(digits, '^0+', '');
  IF length(digits) >= 7 THEN
    parsed := public.missio_phone_e164_try(digits);
    IF parsed IS NOT NULL THEN
      RETURN parsed;
    END IF;
  END IF;

  RETURN NULL;
END;
$fn$;

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
    IF TG_OP = 'UPDATE'
       AND OLD.matched_contact_id IS NOT NULL
       AND NEW.matched_contact_id IS DISTINCT FROM OLD.matched_contact_id
    THEN
      RAISE EXCEPTION 'missio_match_locked'
        USING ERRCODE = '23514';
    END IF;
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

  IF TG_TABLE_NAME = 'missio_followups' THEN
    IF NEW.assigned_user_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.org_staff_roles r
         JOIN public.organisations o ON o.id = r.org_id
         WHERE r.user_id = NEW.assigned_user_id
           AND r.org_id = NEW.org_id
           AND o.slug = 'missio'
       ) THEN
      RAISE EXCEPTION 'missio_user_not_in_org'
        USING ERRCODE = '23503';
    END IF;
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
  'BEFORE write, every role. 23514 missio_match_locked when a confirmed card changes or clears matched_contact_id. 23503 missio_contact_not_in_org when matched_contact_id, contact_id, or assigned_leader_contact_id is set and that contact is not in org_people for the row org. 23503 missio_user_not_in_org when assigned_user_id is set and that user has no org_staff_roles row in the Missio org. Nulls are allowed. When auth.uid() is set, matched_by is overwritten with it; a null auth.uid() keeps the supplied value. matched_at becomes now() when the match or the timestamp changes.';

DROP TRIGGER IF EXISTS trg_connect_response_guard_contact ON public.connect_responses;
CREATE TRIGGER trg_connect_response_guard_contact
  BEFORE INSERT OR UPDATE OF matched_contact_id, matched_by, matched_at, org_id
  ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.guard_missio_connect_contact();

DROP TRIGGER IF EXISTS trg_missio_followup_guard_contact ON public.missio_followups;
CREATE TRIGGER trg_missio_followup_guard_contact
  BEFORE INSERT OR UPDATE OF contact_id, assigned_leader_contact_id, assigned_user_id, org_id
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
CREATE OR REPLACE FUNCTION public.missio_followup_lock(
  p_org uuid,
  p_contact uuid,
  p_phone text
)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_key text;
BEGIN
  IF p_contact IS NOT NULL THEN
    v_key := 'missio_followup:' || p_org::text || ':contact:' || p_contact::text;
  ELSIF p_phone IS NOT NULL THEN
    v_key := 'missio_followup:' || p_org::text || ':phone:' || p_phone;
  ELSE
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));
END;
$fn$;

REVOKE ALL ON FUNCTION public.missio_followup_lock(uuid, uuid, text) FROM PUBLIC;

-- BEFORE INSERT, every role including service role. Ignores a
-- caller-supplied match_status and suggested_contact_id and writes
-- the computed pair. A non-null matched_contact_id on insert is
-- only allowed for a signed-in pastor on a manual card.
-- BEFORE UPDATE forces confirmed when a pastor sets the match,
-- and rejects a suggested contact who is not Missio org_people.
CREATE OR REPLACE FUNCTION public.assign_missio_connect_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_suggested uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.matched_contact_id IS NOT NULL
       AND NEW.matched_contact_id IS DISTINCT FROM OLD.matched_contact_id
    THEN
      NEW.match_status := 'confirmed';
    END IF;
    IF NEW.suggested_contact_id IS NOT NULL
       AND NOT EXISTS (
         SELECT 1
         FROM public.org_people op
         JOIN public.organisations o ON o.id = op.org_id
         WHERE op.org_id = NEW.org_id
           AND op.contact_id = NEW.suggested_contact_id
           AND o.slug = 'missio'
       )
    THEN
      RAISE EXCEPTION 'missio_contact_not_in_org'
        USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.matched_contact_id IS NOT NULL THEN
    IF NEW.source IS DISTINCT FROM 'manual' OR auth.uid() IS NULL THEN
      RAISE EXCEPTION 'missio_match_requires_pastor'
        USING ERRCODE = '23514';
    END IF;
    NEW.match_status := 'confirmed';
    NEW.suggested_contact_id := NULL;
    RETURN NEW;
  END IF;

  v_suggested := NULL;
  IF NEW.phone_e164 IS NOT NULL THEN
    SELECT cr.matched_contact_id INTO v_suggested
    FROM public.connect_responses cr
    WHERE cr.org_id = NEW.org_id
      AND cr.phone_e164 = NEW.phone_e164
      AND cr.matched_contact_id IS NOT NULL
    ORDER BY cr.submitted_at, cr.id
    LIMIT 1;

    IF v_suggested IS NULL THEN
      SELECT f.contact_id INTO v_suggested
      FROM public.missio_followups f
      WHERE f.org_id = NEW.org_id
        AND f.contact_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.connect_responses cr
          WHERE cr.org_id = NEW.org_id
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
  END IF;

  IF v_suggested IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.org_people op
      JOIN public.organisations o ON o.id = op.org_id
      WHERE op.org_id = NEW.org_id
        AND op.contact_id = v_suggested
        AND o.slug = 'missio'
    ) THEN
      RAISE EXCEPTION 'missio_contact_not_in_org'
        USING ERRCODE = '23503';
    END IF;
    NEW.match_status := 'pending_confirm';
    NEW.suggested_contact_id := v_suggested;
    RETURN NEW;
  END IF;

  NEW.match_status := 'unmatched';
  NEW.suggested_contact_id := NULL;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_missio_connect_match() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.assign_missio_connect_match() IS
  'BEFORE INSERT, every role. Computes match_status and suggested_contact_id and ignores the caller. 23514 missio_match_requires_pastor when matched_contact_id is set and the row is not a signed-in manual card. 23503 missio_contact_not_in_org when suggested_contact_id is not Missio org_people. BEFORE UPDATE sets confirmed when the match is first set, and applies the same org check to suggested_contact_id.';

DROP TRIGGER IF EXISTS trg_connect_response_set_match ON public.connect_responses;
CREATE TRIGGER trg_connect_response_set_match
  BEFORE INSERT OR UPDATE OF matched_contact_id, suggested_contact_id, match_status
  ON public.connect_responses
  FOR EACH ROW EXECUTE FUNCTION public.assign_missio_connect_match();

CREATE OR REPLACE FUNCTION public.attach_missio_connect_response()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_followup uuid;
BEGIN
  -- Serialize cards for the same person so two concurrent inserts
  -- attach to one open follow-up instead of both inserting.
  PERFORM public.missio_followup_lock(
    NEW.org_id,
    NEW.matched_contact_id,
    NEW.phone_e164
  );

  -- Phone matched a known contact. The row is pending_confirm.
  -- Do not create a follow-up and do not write a timeline row.
  IF NEW.match_status = 'pending_confirm' THEN
    RETURN NEW;
  END IF;

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
      AND f.contact_id IS NULL
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
  'AFTER INSERT of a connect card. pending_confirm writes no follow-up and no timeline row. An explicit matched_contact_id attaches or creates the follow-up and writes connect_card. No match creates a new follow-up, and a phone match to a follow-up with no contact still attaches to it.';

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
  IF OLD.matched_contact_id IS NOT NULL
     AND NEW.matched_contact_id IS DISTINCT FROM OLD.matched_contact_id THEN
    RAISE EXCEPTION 'missio_match_locked'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.matched_contact_id IS NULL
     OR NEW.matched_contact_id IS NOT DISTINCT FROM OLD.matched_contact_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.missio_followup_lock(NEW.org_id, NEW.matched_contact_id, NULL);

  UPDATE public.connect_responses
     SET match_status = 'confirmed'
   WHERE id = NEW.id;

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

  -- A phone match that was waiting has no follow-up yet.
  IF v_followup IS NULL THEN
    SELECT f.id INTO v_other
    FROM public.missio_followups f
    WHERE f.org_id = NEW.org_id
      AND f.contact_id = NEW.matched_contact_id
      AND f.stage <> 'joined'
    ORDER BY f.created_at, f.id
    LIMIT 1;

    IF v_other IS NULL THEN
      INSERT INTO public.missio_followups (org_id, contact_id, connect_response_id, stage)
      VALUES (NEW.org_id, NEW.matched_contact_id, NEW.id, 'new')
      RETURNING id INTO v_followup;
    ELSE
      v_followup := v_other;
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
  END IF;

  IF v_contact IS NOT NULL THEN
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

-- A pastor says the phone match is not this person. The card becomes
-- unmatched, the suggestion is cleared, and the newcomer gets their
-- own follow-up. The suggested contact's timeline is left alone.
CREATE OR REPLACE FUNCTION public.decline_missio_connect_match(card_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org uuid;
  v_phone text;
  v_status text;
  v_followup uuid;
BEGIN
  IF NOT (SELECT public.has_org_role('missio', ARRAY['pastor'])) THEN
    RAISE EXCEPTION 'missio_pastor_required'
      USING ERRCODE = '42501';
  END IF;

  SELECT cr.org_id, cr.phone_e164, cr.match_status
    INTO v_org, v_phone, v_status
  FROM public.connect_responses cr
  WHERE cr.id = card_id
  FOR UPDATE;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'missio_card_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_status IS DISTINCT FROM 'pending_confirm' THEN
    RAISE EXCEPTION 'missio_decline_not_pending'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.missio_followup_lock(v_org, NULL, v_phone);

  UPDATE public.connect_responses
     SET match_status = 'unmatched',
         suggested_contact_id = NULL
   WHERE id = card_id;

  INSERT INTO public.missio_followups (
    org_id, contact_id, connect_response_id, stage
  ) VALUES (
    v_org, NULL, card_id, 'new'
  )
  RETURNING id INTO v_followup;

  INSERT INTO public.missio_followup_stage_history (
    followup_id, kind, connect_response_id, changed_by
  ) VALUES (
    v_followup, 'connect_card', card_id, auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.decline_missio_connect_match(uuid) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.decline_missio_connect_match(uuid) IS
  'Pastor only. Turns a pending_confirm card into unmatched, clears suggested_contact_id, and creates that newcomer''s own stage-new follow-up plus a connect_card timeline row. Takes the missio_followup lock on the card phone. changed_by is auth.uid(). 42501 missio_pastor_required when the caller is not a Missio pastor. 23514 missio_decline_not_pending when the card is not pending. P0002 missio_card_not_found when the card does not exist.';

COMMENT ON FUNCTION public.link_missio_connect_match() IS
  'AFTER UPDATE of matched_contact_id. Takes the missio_followup lock, marks the card confirmed, and creates or attaches the follow-up plus the connect_card timeline row. A card that already has an empty follow-up gets the contact when no other open follow-up has it. A clash writes a note on both and leaves them unmerged. changed_by is auth.uid() when that is set.';

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
        WHERE op.org_id = connect_responses.org_id
          AND op.contact_id = connect_responses.matched_contact_id
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
        WHERE op.org_id = connect_responses.org_id
          AND op.contact_id = connect_responses.matched_contact_id
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
        WHERE op.org_id = missio_followups.org_id
          AND op.contact_id = missio_followups.contact_id
      )
    )
    AND (
      assigned_leader_contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = missio_followups.org_id
          AND op.contact_id = missio_followups.assigned_leader_contact_id
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
        WHERE op.org_id = missio_followups.org_id
          AND op.contact_id = missio_followups.contact_id
      )
    )
    AND (
      assigned_leader_contact_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.org_people op
        WHERE op.org_id = missio_followups.org_id
          AND op.contact_id = missio_followups.assigned_leader_contact_id
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
