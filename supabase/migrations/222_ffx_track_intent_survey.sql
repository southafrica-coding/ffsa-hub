-- ============================================================
-- FFSA Hub — Migration 222: FFX track-intent survey (one-off)
-- ============================================================
-- FFX's real per-segment pricing isn't configured yet — its three billing
-- courses (FFX/FFBX/FFWX) are still scope='full_program' with no
-- fee_charge_items, so the migration-221 segment picker (application_
-- segment_choices / enrollment_segments) can't be wired up for this
-- program yet. This is a standalone, throwaway table to survey every
-- current FFX applicant and accepted student's intent (whole programme vs
-- specific segments) via an emailed token link — pure intent-gathering.
-- Deliberately has no FK into billing_courses, so it never depends on how
-- finance ends up structuring the real segment pricing; `intent` just
-- records the segment codes (FFX/FFBX/FFWX) as plain strings.
-- ============================================================

CREATE TABLE public.ffx_track_intent_surveys (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_response_id uuid NOT NULL REFERENCES public.application_responses(id) ON DELETE CASCADE,
  token                   text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  email                   text NOT NULL,
  -- {"whole_program": true} or {"whole_program": false, "segments": ["FFX","FFBX"]}
  intent                  jsonb,
  submitted_at            timestamptz,
  email_sent_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ffx_tis_response_key ON public.ffx_track_intent_surveys (application_response_id);
CREATE INDEX idx_ffx_tis_token ON public.ffx_track_intent_surveys(token);

-- Written only by the token-based public submit route and the one-off admin
-- send route, both via the service-role client. Staff can read for
-- reporting (no write policy — nobody but the service role writes this).
ALTER TABLE public.ffx_track_intent_surveys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read ffx track intent surveys"
  ON public.ffx_track_intent_surveys FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ------------------------------------------------------------
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.ffx_track_intent_surveys;
-- ------------------------------------------------------------
