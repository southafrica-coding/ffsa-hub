-- ============================================================
-- FFSA Hub — Migration 193: an event can carry several base labels
-- ------------------------------------------------------------
-- events.base_label_id held exactly one label, so an event could only
-- ever push its people into a single CRM audience. Real events want
-- more than one (e.g. "SEND 2026" + "Youth"), applied to everyone who
-- comes in through the event — form respondents and ticket buyers.
--
-- base_label_id is KEPT, not dropped: it is the PRIMARY label, still
-- read by the form builder as a new form's default label_id, and by any
-- code that has not been taught about the set. event_labels is the full
-- set and always CONTAINS the primary; the API writes both together.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.event_labels (
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES public.labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_event_labels_label ON public.event_labels(label_id);

-- Backfill: every event that already had a base label keeps it, now as
-- the first member of its set.
INSERT INTO public.event_labels (event_id, label_id)
SELECT id, base_label_id
FROM public.events
WHERE base_label_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE public.event_labels ENABLE ROW LEVEL SECURITY;

-- Read/write mirrors the events policies from 086: whoever may see or
-- edit an event may see or edit which labels it feeds.
DROP POLICY IF EXISTS "Event viewers can read event labels" ON public.event_labels;
CREATE POLICY "Event viewers can read event labels"
  ON public.event_labels FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.view')
    OR public.has_permission('events.create')
  );

DROP POLICY IF EXISTS "Event editors can add event labels" ON public.event_labels;
CREATE POLICY "Event editors can add event labels"
  ON public.event_labels FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.create')
  );

DROP POLICY IF EXISTS "Event editors can remove event labels" ON public.event_labels;
CREATE POLICY "Event editors can remove event labels"
  ON public.event_labels FOR DELETE
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.create')
  );

COMMENT ON TABLE public.event_labels IS
  'Every CRM label an event applies to the people who come through it (form respondents and ticket buyers). Always contains events.base_label_id, which remains the primary label used as a new form''s default.';
