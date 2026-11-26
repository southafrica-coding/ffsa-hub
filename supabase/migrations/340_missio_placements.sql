-- ============================================================
-- FFSA Hub — Migration 340: Missio placements
-- ============================================================
-- Depends on 329, 331 (house_churches, house_church_members),
-- 332 (follow-up) and 338 (missio_my_house_ids).
-- Boards M12a (pastor), M12b (the person), M12c (the leader).
--
-- Pastors place people, leaders receive them (Jack). A placement
-- follows someone through four steps: placed → leader said hi →
-- first visit → joined. "Joined" adds the house membership, which
-- (via 332's trigger) closes their follow-up. Coaches see it for
-- their houses; nothing waits on them.
--
-- Each placement has two links with no login: the person's
-- next-steps page and the leader's "tap when done" page. Only token
-- hashes and nonces are stored. The meeting address is shown to the
-- person only after the leader has said hi.
--
-- Writes come only from the service role, after the API has checked
-- the pastor or the token. Pastors read all; coaches and leaders read
-- placements into their houses.
--
-- Idempotent.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.missio_placements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          uuid NOT NULL REFERENCES public.contacts (id) ON DELETE RESTRICT,
  house_church_id     uuid NOT NULL REFERENCES public.house_churches (id) ON DELETE CASCADE,
  placed_by           uuid REFERENCES public.users (id) ON DELETE SET NULL,
  placed_at           timestamptz NOT NULL DEFAULT now(),
  leader_deadline     date NOT NULL,
  leader_said_hi_at   timestamptz,
  first_visit_at      timestamptz,
  joined_at           timestamptz,
  cancelled_at        timestamptz,
  cant_make_it_at     timestamptz,
  person_nonce        text NOT NULL,
  person_token_hash   text NOT NULL CHECK (person_token_hash ~ '^[0-9a-f]{64}$'),
  leader_nonce        text NOT NULL,
  leader_token_hash   text NOT NULL CHECK (leader_token_hash ~ '^[0-9a-f]{64}$'),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- One open placement per person.
CREATE UNIQUE INDEX IF NOT EXISTS missio_placements_open_person_uidx
  ON public.missio_placements (contact_id)
  WHERE joined_at IS NULL AND cancelled_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS missio_placements_person_token_uidx
  ON public.missio_placements (person_token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS missio_placements_leader_token_uidx
  ON public.missio_placements (leader_token_hash);
CREATE INDEX IF NOT EXISTS missio_placements_house_idx
  ON public.missio_placements (house_church_id);

COMMENT ON TABLE public.missio_placements IS
  'A person placed in a house by a pastor, tracked placed → leader said hi → first visit → joined. Joined adds the membership. Token hashes only. Service role writes.';

DROP TRIGGER IF EXISTS set_updated_at ON public.missio_placements;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON public.missio_placements
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.missio_placements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.missio_placements FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, contact_id, house_church_id, placed_by, placed_at, leader_deadline,
  leader_said_hi_at, first_visit_at, joined_at, cancelled_at, cant_make_it_at,
  created_at, updated_at
) ON TABLE public.missio_placements TO authenticated;
GRANT ALL ON TABLE public.missio_placements TO service_role;

DROP POLICY IF EXISTS "Pastors can read placements" ON public.missio_placements;
CREATE POLICY "Pastors can read placements"
  ON public.missio_placements
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

DROP POLICY IF EXISTS "Coaches and leaders can read placements into their houses" ON public.missio_placements;
CREATE POLICY "Coaches and leaders can read placements into their houses"
  ON public.missio_placements
  FOR SELECT
  TO authenticated
  USING (house_church_id IN (SELECT public.missio_my_house_ids()));
