-- ============================================================
-- FFSA Hub — Migration 342: Missio next leaders
-- ============================================================
-- Depends on 329/331 (house churches), 338 (missio_my_house_ids).
-- Board M12d.
--
-- Multiplication starts with people. Anyone a leader, coach or
-- pastor sees potential in is nominated in a house and moves through
-- three stages: spotted → in training → ready to lead. Each stage
-- keeps its date, so the person's journey shows "In training with
-- Esther". "Ready to multiply" needs a full house and someone ready.
--
-- Pastors anywhere; coaches across their houses; leaders in their
-- own house (missio_my_house_ids()). Reads and writes use the
-- caller's session (RLS).
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missio_next_leaders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organisations (id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES public.contacts (id) ON DELETE CASCADE,
  house_church_id     uuid NOT NULL REFERENCES public.house_churches (id) ON DELETE CASCADE,
  trainer_contact_id  uuid REFERENCES public.contacts (id) ON DELETE SET NULL,
  stage               text NOT NULL DEFAULT 'spotted' CHECK (stage IN ('spotted', 'in_training', 'ready')),
  note                text CHECK (note IS NULL OR char_length(note) <= 280),
  spotted_at          timestamptz NOT NULL DEFAULT now(),
  training_at         timestamptz,
  ready_at            timestamptz,
  ended_at            timestamptz,
  nominated_by        uuid REFERENCES public.users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One open nomination per person.
CREATE UNIQUE INDEX IF NOT EXISTS missio_next_leaders_open_contact_uidx
  ON public.missio_next_leaders (contact_id)
  WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS missio_next_leaders_house_idx
  ON public.missio_next_leaders (house_church_id);

COMMENT ON TABLE public.missio_next_leaders IS
  'Next leaders pipeline (board M12d): spotted → in training → ready to lead, per house, with a trainer and a note.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_next_leaders;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_next_leaders
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.missio_next_leaders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_next_leaders FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.missio_next_leaders TO authenticated;
GRANT ALL ON TABLE public.missio_next_leaders TO service_role;

DROP POLICY IF EXISTS "Pastors manage next leaders" ON public.missio_next_leaders;
CREATE POLICY "Pastors manage next leaders"
  ON public.missio_next_leaders
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

DROP POLICY IF EXISTS "Coaches and leaders read next leaders in their houses" ON public.missio_next_leaders;
CREATE POLICY "Coaches and leaders read next leaders in their houses"
  ON public.missio_next_leaders
  FOR SELECT
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_my_house_ids()));

DROP POLICY IF EXISTS "Coaches and leaders nominate in their houses" ON public.missio_next_leaders;
CREATE POLICY "Coaches and leaders nominate in their houses"
  ON public.missio_next_leaders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    house_church_id IN (SELECT public.missio_my_house_ids())
    AND org_id = (SELECT o.id FROM public.organisations o WHERE o.slug = 'missio')
  );

DROP POLICY IF EXISTS "Coaches and leaders move next leaders in their houses" ON public.missio_next_leaders;
CREATE POLICY "Coaches and leaders move next leaders in their houses"
  ON public.missio_next_leaders
  FOR UPDATE
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_my_house_ids()))
  WITH CHECK (house_church_id IN (SELECT public.missio_my_house_ids()));
