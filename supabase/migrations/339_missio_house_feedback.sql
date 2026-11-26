-- ============================================================
-- FFSA Hub — Migration 339: Missio weekly house feedback
-- ============================================================
-- Depends on 329, 331 (house_churches) and 338 (missio_my_house_ids).
-- Boards M4a (the leader's form) and M4b (history).
--
-- Each house has one feedback link. The leader opens it after the
-- meeting, with no login, and answers four questions. The link is a
-- token: only its SHA-256 hash and a nonce are stored. A pastor can
-- rotate it, which kills the old link. Writes come only from the
-- service role, after the token is checked.
--
-- One row per house per meeting date. Sending again the same week
-- updates that row. A missed week has no row (charts show a gap,
-- never a zero).
--
-- Who reads: pastors (all), and coaches and leaders for their own
-- houses (missio_my_house_ids from 338). Prayer needs are in the row,
-- so house members never read it. Nobody but the service role writes.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missio_feedback_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_church_id  uuid NOT NULL REFERENCES public.house_churches (id) ON DELETE CASCADE,
  nonce            text NOT NULL,
  token_hash       text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_by       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS missio_feedback_links_house_uidx
  ON public.missio_feedback_links (house_church_id);
CREATE UNIQUE INDEX IF NOT EXISTS missio_feedback_links_hash_uidx
  ON public.missio_feedback_links (token_hash);

COMMENT ON TABLE public.missio_feedback_links IS
  'One weekly-feedback link per house. Only the token hash and nonce are stored; rotating replaces both. Service role writes only.';

CREATE TABLE IF NOT EXISTS public.missio_house_feedback (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  house_church_id  uuid NOT NULL REFERENCES public.house_churches (id) ON DELETE CASCADE,
  meeting_date     date NOT NULL,
  attendance       int NOT NULL CHECK (attendance BETWEEN 0 AND 500),
  mood             text NOT NULL CHECK (mood IN ('hard', 'okay', 'good', 'great')),
  new_names        text[] NOT NULL DEFAULT '{}' CHECK (cardinality(new_names) <= 20),
  prayer           text CHECK (prayer IS NULL OR char_length(prayer) <= 2000),
  notes            text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  link_id          uuid REFERENCES public.missio_feedback_links (id) ON DELETE SET NULL,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (house_church_id, meeting_date)
);

CREATE INDEX IF NOT EXISTS missio_house_feedback_date_idx
  ON public.missio_house_feedback (meeting_date DESC);

COMMENT ON TABLE public.missio_house_feedback IS
  'Weekly house feedback (M4a). One row per house per meeting date; a missed week has no row. Read by pastors, and by coaches and leaders for their own houses. Service role writes only.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_feedback_links;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_feedback_links
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_house_feedback;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_house_feedback
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.missio_feedback_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missio_house_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_feedback_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.missio_house_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.missio_house_feedback TO authenticated;
GRANT ALL ON TABLE public.missio_feedback_links TO service_role;
GRANT ALL ON TABLE public.missio_house_feedback TO service_role;

DROP POLICY IF EXISTS "Pastors can read house feedback" ON public.missio_house_feedback;
CREATE POLICY "Pastors can read house feedback"
  ON public.missio_house_feedback
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

DROP POLICY IF EXISTS "Coaches and leaders can read their house feedback" ON public.missio_house_feedback;
CREATE POLICY "Coaches and leaders can read their house feedback"
  ON public.missio_house_feedback
  FOR SELECT
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_my_house_ids()));
