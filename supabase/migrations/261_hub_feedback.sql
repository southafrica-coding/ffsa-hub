-- ============================================================
-- FFSA Hub — Migration 261: Hub feedback (phase 1)
-- ============================================================
-- One pipeline for problems, ideas and vision about the Hub itself, so
-- they stop arriving by text message and in the corridor.
--
--   Everyone signed in can SUBMIT, and sees only their own items.
--   feedback.view   — the dev team: read the whole board, write team notes
--   feedback.triage — move items through the pipeline, assign, merge
--   super_admin has both. The general `admin` role does NOT — this module
--   is a SUPER_ADMIN_ONLY_MODULES carve-out (src/config/modules.ts), so
--   admins need an explicit grant, same rule as the Records Library (212).
--
-- Pipeline: new → needs_info → accepted → planned → in_progress → shipped,
-- plus declined and duplicate. Nothing is ever deleted: a duplicate keeps
-- its row and points at the item it was merged into (duplicate_of).
--
-- History is written by trigger, so every status / assignment / merge is
-- recorded whichever client made the change.
-- Screenshots live in the private 'hub-feedback' bucket; the app reads and
-- writes them only through the service-role client, so no storage policies.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Permissions + access helpers
-- ────────────────────────────────────────────────────────────

INSERT INTO public.permissions (module, key, display_name, sort_order) VALUES
  ('hub-feedback', 'feedback.view',   'View Hub feedback board', 10),
  ('hub-feedback', 'feedback.triage', 'Triage Hub feedback',     20)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.can_view_hub_feedback()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(ARRAY['super_admin'])
      OR public.has_permission('feedback.view')
      OR public.has_permission('feedback.triage');
$$;

CREATE OR REPLACE FUNCTION public.can_triage_hub_feedback()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(ARRAY['super_admin'])
      OR public.has_permission('feedback.triage');
$$;

-- ────────────────────────────────────────────────────────────
-- 2. Tables
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.hub_feedback (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref               integer GENERATED ALWAYS AS IDENTITY UNIQUE, -- "#12" in the UI
  kind              text NOT NULL CHECK (kind IN ('problem', 'idea', 'vision')),
  title             text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  details           text,
  severity          text CHECK (severity IN ('blocking', 'annoying', 'minor')),
  status            text NOT NULL DEFAULT 'new' CHECK (status IN (
                      'new', 'needs_info', 'accepted', 'planned', 'in_progress',
                      'shipped', 'declined', 'duplicate')),
  -- The last message to the submitter about a status change
  -- ("what do you mean by X?", "shipped — look under Fleet").
  status_note       text,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  source            text NOT NULL DEFAULT 'hub' CHECK (source IN ('hub', 'slack')),
  -- Where they were when they hit the button.
  page_path         text,
  module_id         text,
  module_label      text,
  user_agent        text,
  viewport          text,
  submitted_by      uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users (id),
  assigned_to       uuid REFERENCES public.users (id) ON DELETE SET NULL,
  duplicate_of      uuid REFERENCES public.hub_feedback (id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (duplicate_of IS NULL OR duplicate_of <> id),
  CHECK ((status = 'duplicate') = (duplicate_of IS NOT NULL))
);

CREATE INDEX idx_hub_feedback_status     ON public.hub_feedback (status, created_at DESC);
CREATE INDEX idx_hub_feedback_submitter  ON public.hub_feedback (submitted_by, created_at DESC);
CREATE INDEX idx_hub_feedback_duplicate  ON public.hub_feedback (duplicate_of) WHERE duplicate_of IS NOT NULL;

-- Notes on an item. 'team' = the dev team only. 'submitter' = the
-- conversation with the person who sent it (questions + their replies).
CREATE TABLE public.hub_feedback_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES public.hub_feedback (id) ON DELETE CASCADE,
  author_id   uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users (id),
  visibility  text NOT NULL CHECK (visibility IN ('team', 'submitter')),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hub_feedback_comments_item ON public.hub_feedback_comments (feedback_id, created_at);

-- Append-only history, written by the trigger below.
CREATE TABLE public.hub_feedback_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id uuid NOT NULL REFERENCES public.hub_feedback (id) ON DELETE CASCADE,
  actor_id    uuid REFERENCES public.users (id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('created', 'status', 'assigned', 'merged')),
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hub_feedback_events_item ON public.hub_feedback_events (feedback_id, created_at);

CREATE TABLE public.hub_feedback_files (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feedback_id  uuid NOT NULL REFERENCES public.hub_feedback (id) ON DELETE CASCADE,
  file_path    text NOT NULL,
  file_name    text,
  content_type text,
  uploaded_by  uuid NOT NULL DEFAULT auth.uid() REFERENCES public.users (id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_hub_feedback_files_item ON public.hub_feedback_files (feedback_id);

-- ────────────────────────────────────────────────────────────
-- 3. Triggers: timestamps + history
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hub_feedback_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hub_feedback_touch
  BEFORE UPDATE ON public.hub_feedback
  FOR EACH ROW EXECUTE FUNCTION public.hub_feedback_touch();

CREATE OR REPLACE FUNCTION public.hub_feedback_log()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.hub_feedback_events (feedback_id, actor_id, kind, to_status)
    VALUES (NEW.id, COALESCE(auth.uid(), NEW.submitted_by), 'created', NEW.status);
    RETURN NEW;
  END IF;

  IF NEW.duplicate_of IS DISTINCT FROM OLD.duplicate_of AND NEW.duplicate_of IS NOT NULL THEN
    INSERT INTO public.hub_feedback_events (feedback_id, actor_id, kind, from_status, to_status, note)
    VALUES (NEW.id, auth.uid(), 'merged', OLD.status, NEW.status,
            (SELECT '#' || f.ref || ' ' || f.title FROM public.hub_feedback f WHERE f.id = NEW.duplicate_of));
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.hub_feedback_events (feedback_id, actor_id, kind, from_status, to_status, note)
    VALUES (NEW.id, auth.uid(), 'status', OLD.status, NEW.status, NEW.status_note);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO public.hub_feedback_events (feedback_id, actor_id, kind, note)
    VALUES (NEW.id, auth.uid(), 'assigned', NEW.assigned_to::text);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_hub_feedback_log
  AFTER INSERT OR UPDATE ON public.hub_feedback
  FOR EACH ROW EXECUTE FUNCTION public.hub_feedback_log();

-- ────────────────────────────────────────────────────────────
-- 4. RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.hub_feedback          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_feedback_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_feedback_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hub_feedback_files    ENABLE ROW LEVEL SECURITY;

-- Items: your own, or the whole board for the team. Anyone may submit
-- (as themselves, into 'new'); only triage may change an item. No delete
-- policy — declined / duplicate keep the record.
CREATE POLICY hub_fb_select ON public.hub_feedback FOR SELECT TO authenticated
  USING (submitted_by = auth.uid() OR public.can_view_hub_feedback());
CREATE POLICY hub_fb_insert ON public.hub_feedback FOR INSERT TO authenticated
  WITH CHECK (submitted_by = auth.uid() AND status = 'new' AND duplicate_of IS NULL AND assigned_to IS NULL);
CREATE POLICY hub_fb_update ON public.hub_feedback FOR UPDATE TO authenticated
  USING (public.can_triage_hub_feedback())
  WITH CHECK (public.can_triage_hub_feedback());

-- Comments: the team sees all; a submitter sees (and writes) only the
-- 'submitter' thread on their own item.
CREATE POLICY hub_fb_comments_select ON public.hub_feedback_comments FOR SELECT TO authenticated
  USING (
    public.can_view_hub_feedback()
    OR (visibility = 'submitter' AND EXISTS (
          SELECT 1 FROM public.hub_feedback f
          WHERE f.id = feedback_id AND f.submitted_by = auth.uid()))
  );
CREATE POLICY hub_fb_comments_insert ON public.hub_feedback_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.can_view_hub_feedback()
      OR (visibility = 'submitter' AND EXISTS (
            SELECT 1 FROM public.hub_feedback f
            WHERE f.id = feedback_id AND f.submitted_by = auth.uid()))
    )
  );

-- History: the team sees all; a submitter sees their item's status trail
-- but not who it was assigned to.
CREATE POLICY hub_fb_events_select ON public.hub_feedback_events FOR SELECT TO authenticated
  USING (
    public.can_view_hub_feedback()
    OR (kind IN ('created', 'status', 'merged') AND EXISTS (
          SELECT 1 FROM public.hub_feedback f
          WHERE f.id = feedback_id AND f.submitted_by = auth.uid()))
  );

CREATE POLICY hub_fb_files_select ON public.hub_feedback_files FOR SELECT TO authenticated
  USING (
    public.can_view_hub_feedback()
    OR EXISTS (SELECT 1 FROM public.hub_feedback f
               WHERE f.id = feedback_id AND f.submitted_by = auth.uid())
  );
CREATE POLICY hub_fb_files_insert ON public.hub_feedback_files FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND (public.can_view_hub_feedback()
         OR EXISTS (SELECT 1 FROM public.hub_feedback f
                    WHERE f.id = feedback_id AND f.submitted_by = auth.uid()))
  );

-- ────────────────────────────────────────────────────────────
-- 5. Storage
-- ────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit) VALUES
  ('hub-feedback', 'hub-feedback', false, 10485760)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT key FROM public.permissions WHERE module = 'hub-feedback';
--   -- expect feedback.view, feedback.triage
--   SELECT public.can_view_hub_feedback(), public.can_triage_hub_feedback();
--   -- as a super_admin in the app: true, true
--   SELECT id, public FROM storage.buckets WHERE id = 'hub-feedback';
-- ============================================================
