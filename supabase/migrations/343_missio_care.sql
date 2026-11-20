-- ============================================================
-- FFSA Hub — Migration 343: Missio care
-- ============================================================
-- Depends on 332 (connect_responses), 339 (missio_house_feedback).
-- Board M14b.
--
-- One Care board, fed from every door: the public care form, prayer
-- requests on connect cards, prayer from weekly house feedback, and
-- needs a pastor logs by hand. New → someone's on it → done.
--
-- The person decides who may know (privacy): pastors only, pastors
-- and their house leaders, or their house church may pray too. This
-- migration gives pastors the board; leader visibility follows later.
--
-- The public form is written by the service role after the API's
-- rate limit. Only an HMAC of the client IP is kept. Prayer can be
-- anonymous; talk and practical help need a phone.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missio_care_requests (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  source           text NOT NULL CHECK (source IN ('care_form', 'connect_card', 'house_feedback', 'manual')),
  source_id        uuid,
  contact_id       uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  house_church_id  uuid REFERENCES public.house_churches (id) ON DELETE SET NULL,
  name             text CHECK (name IS NULL OR char_length(name) BETWEEN 1 AND 80),
  phone            text CHECK (phone IS NULL OR char_length(phone) BETWEEN 5 AND 40),
  needs            text[] NOT NULL DEFAULT ARRAY['prayer']::text[]
                   CHECK (needs <@ ARRAY['prayer', 'talk', 'practical']::text[] AND cardinality(needs) BETWEEN 1 AND 3),
  body             text CHECK (body IS NULL OR char_length(body) <= 2000),
  privacy          text NOT NULL DEFAULT 'pastors' CHECK (privacy IN ('pastors', 'pastors_leaders', 'house')),
  urgent           boolean NOT NULL DEFAULT false,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'on_it', 'done')),
  taken_by         uuid REFERENCES public.users (id) ON DELETE SET NULL,
  taken_at         timestamptz,
  done_at          timestamptz,
  done_note        text CHECK (done_note IS NULL OR char_length(done_note) <= 200),
  checked_in_at    timestamptz,
  created_by       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  rate_key_hash    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- Someone will reply to talk and practical help, so they need a number.
  CONSTRAINT missio_care_reply_needs_phone CHECK (
    source <> 'care_form' OR needs = ARRAY['prayer']::text[] OR phone IS NOT NULL
  )
);

-- A connect card or a week's feedback lands on the board once.
CREATE UNIQUE INDEX IF NOT EXISTS missio_care_requests_source_uidx
  ON public.missio_care_requests (source, source_id)
  WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS missio_care_requests_org_status_idx
  ON public.missio_care_requests (org_id, status, created_at DESC);

COMMENT ON TABLE public.missio_care_requests IS
  'Missio care board (M14b): care form, connect-card prayer, house-feedback prayer and needs logged by hand. The person chose who may know (privacy).';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_care_requests;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_care_requests
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.missio_care_requests ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_care_requests FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.missio_care_requests TO authenticated;
GRANT ALL ON TABLE public.missio_care_requests TO service_role;

DROP POLICY IF EXISTS "Pastors manage care requests" ON public.missio_care_requests;
CREATE POLICY "Pastors manage care requests"
  ON public.missio_care_requests
  FOR ALL
  TO authenticated
  USING (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  )
  WITH CHECK (
    (SELECT public.has_org_role('missio', ARRAY['pastor']))
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
    AND source <> 'care_form'
  );
