-- ============================================================
-- FFSA Hub — Migration 171: curated bands
-- Prayer room rebuild, PHASE E. See docs/redesign/07-prayer-room-reconciliation.md
-- ============================================================
-- MORNING (08:00–09:30) / NOON (12:00–14:00) / NIGHT (17:00–19:00) are the
-- anchors of the wall: named in the gutter, tinted across every day, and
-- curated centrally rather than claimed by whoever gets there first.
--
-- The handoff proposes a `prayer_bands` table. Not built: bands already exist
-- as prayer_room_template_blocks (day_of_week, start_time, end_time, title,
-- role_needs), which is what instantiates the week. A second table would mean
-- two things generating sets. This adds the missing attributes instead.
--
-- One row per day is intentional and unchanged — the handoff's `weekdays int[]`
-- would collapse five rows into one and break the existing instantiation
-- function, which reads a block per day.
-- ============================================================

ALTER TABLE public.prayer_room_template_blocks
  ADD COLUMN IF NOT EXISTS band_name    text,
  ADD COLUMN IF NOT EXISTS weekly_focus text,
  ADD COLUMN IF NOT EXISTS lead_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  -- Curated = evaluators own this time. Not claimable, not deletable by
  -- members, and drawn as the yellow anchor band rather than a bone card.
  ADD COLUMN IF NOT EXISTS is_curated   boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.prayer_room_template_blocks.band_name IS
  'MORNING / NOON / NIGHT. The label shown in the wall gutter; groups the per-day rows into one named band.';
COMMENT ON COLUMN public.prayer_room_template_blocks.is_curated IS
  'Evaluators curate this time centrally. Sets generated from it cannot be claimed, edited or deleted by ordinary members.';

CREATE INDEX IF NOT EXISTS idx_prayer_template_curated
  ON public.prayer_room_template_blocks (is_curated) WHERE is_curated;

-- Only evaluators and staff curate the bands (times, lead, weekly focus).
-- Ordinary template edits stay with staff, as before.
DROP POLICY IF EXISTS "Evaluators curate bands" ON public.prayer_room_template_blocks;
CREATE POLICY "Evaluators curate bands" ON public.prayer_room_template_blocks
  FOR UPDATE TO authenticated
  USING (is_curated AND public.has_permission('prayer_room.evaluate'))
  WITH CHECK (is_curated AND public.has_permission('prayer_room.evaluate'));

-- ────────────────────────────────────────────────────────────
-- Curated sets are not bookable (design rule 6)
-- ────────────────────────────────────────────────────────────
-- Enforced in the policies rather than the UI: a set whose template block is
-- curated may only be changed or removed by staff. Owners keep full control of
-- their own ordinary sets, exactly as before.
CREATE OR REPLACE FUNCTION public.prayer_set_is_curated(target_set uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.prayer_room_sets s
      JOIN public.prayer_room_template_blocks t ON t.id = s.template_block_id
     WHERE s.id = target_set AND t.is_curated
  );
$$;

COMMENT ON FUNCTION public.prayer_set_is_curated(uuid) IS
  'True when this set was generated from a curated band. Such sets are centrally owned: members cannot claim, edit or delete them.';

DROP POLICY IF EXISTS "Update sets" ON public.prayer_room_sets;
CREATE POLICY "Update sets" ON public.prayer_room_sets
  FOR UPDATE TO authenticated
  USING (
    public.is_prayer_room_staff()
    OR (owner_id = auth.uid() AND NOT public.prayer_set_is_curated(id))
  )
  WITH CHECK (
    public.is_prayer_room_staff()
    OR (owner_id = auth.uid() AND NOT public.prayer_set_is_curated(id))
  );

DROP POLICY IF EXISTS "Delete sets" ON public.prayer_room_sets;
CREATE POLICY "Delete sets" ON public.prayer_room_sets
  FOR DELETE TO authenticated
  USING (
    public.is_prayer_room_staff()
    OR (owner_id = auth.uid() AND NOT public.prayer_set_is_curated(id))
  );

-- The roster of a curated set is likewise not a member's to rearrange.
DROP POLICY IF EXISTS "Owner or staff manage roster" ON public.prayer_room_set_slots;
CREATE POLICY "Owner or staff manage roster" ON public.prayer_room_set_slots
  FOR ALL TO authenticated
  USING (
    public.is_prayer_room_staff()
    OR EXISTS (
      SELECT 1 FROM public.prayer_room_sets s
       WHERE s.id = set_id
         AND s.owner_id = auth.uid()
         AND NOT public.prayer_set_is_curated(s.id)
    )
  )
  WITH CHECK (
    public.is_prayer_room_staff()
    OR EXISTS (
      SELECT 1 FROM public.prayer_room_sets s
       WHERE s.id = set_id
         AND s.owner_id = auth.uid()
         AND NOT public.prayer_set_is_curated(s.id)
    )
  );

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   -- Nothing is curated yet — this migration adds the capability, it does
--   -- not decide which blocks are bands. Expect 0:
--   SELECT count(*) FROM public.prayer_room_template_blocks WHERE is_curated;
--
--   -- Nobody's existing set changed hands (curated is false everywhere, so
--   -- prayer_set_is_curated() is false and the policies behave as before):
--   SELECT count(*) FROM public.prayer_room_sets s
--     WHERE public.prayer_set_is_curated(s.id);
--   -- expect 0
--
--   -- To make the anchors real, name the blocks. Example for MORNING:
--   -- UPDATE public.prayer_room_template_blocks
--   --    SET band_name = 'MORNING', is_curated = true
--   --  WHERE start_time = '08:00' AND end_time = '09:30';
-- ============================================================

-- ------------------------------------------------------------
-- ROLLBACK:
--   -- restore the two set policies from migration 084, then:
--   DROP FUNCTION IF EXISTS public.prayer_set_is_curated(uuid);
--   ALTER TABLE public.prayer_room_template_blocks
--     DROP COLUMN IF EXISTS band_name,
--     DROP COLUMN IF EXISTS weekly_focus,
--     DROP COLUMN IF EXISTS lead_user_id,
--     DROP COLUMN IF EXISTS is_curated;
-- ------------------------------------------------------------
