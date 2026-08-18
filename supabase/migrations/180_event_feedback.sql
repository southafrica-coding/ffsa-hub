-- ============================================================
-- FFSA Hub — Migration 180: Event feedback (post-event debrief)
-- ============================================================
-- A per-event feedback survey aimed at the people who WORKED the
-- event — roster, volunteers, team leads — so the next one is run
-- better than the last.
--
-- Deliberately separate from public.forms (migration 044). Those
-- are contact-capture tools: forms.label_id is NOT NULL, and a
-- submission upserts a contact, applies a label and fires outcome
-- workflows. None of that should happen when your own MC tells you
-- the sound was bad. Feedback answers are analytics, not CRM rows.
--
-- Distribution model: ONE open link per form (/fb/<slug>) plus a QR,
-- shared however the team already talks (WhatsApp, Slack, email).
-- There is no per-person token. `event_feedback_sends` only records
-- that the link was emailed to an address, which is what powers the
-- "remind the ones who haven't answered" button.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- event_feedback_forms
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.event_feedback_forms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id           uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  slug               text UNIQUE NOT NULL,
  title              text NOT NULL,
  intro              text,
  schema             jsonb NOT NULL DEFAULT '{"version":1,"sections":[]}'::jsonb,
  -- Anonymous forms skip the "who are you" step entirely; named forms
  -- ask for a name (required) and email (optional) up front.
  is_anonymous       boolean NOT NULL DEFAULT false,
  status             text NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft', 'open', 'closed')),
  -- Optional auto-close. Enforced at read time by the public route,
  -- not by a cron — the Hub is on a Vercel plan with daily crons only.
  closes_at          timestamptz,
  thank_you_heading  text,
  thank_you_message  text,
  created_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_feedback_forms_event ON public.event_feedback_forms (event_id);
CREATE INDEX idx_event_feedback_forms_slug  ON public.event_feedback_forms (slug);

ALTER TABLE public.event_feedback_forms ENABLE ROW LEVEL SECURITY;

-- The /fb/<slug> page runs on the anon client, so an open form has to be
-- readable by anyone holding the link. Drafts and closed forms are staff-only.
CREATE POLICY "Open feedback forms readable by anyone"
  ON public.event_feedback_forms FOR SELECT
  USING (
    status = 'open'
    OR public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.view')
    OR public.has_permission('events.create')
  );

CREATE POLICY "Events managers can manage feedback forms"
  ON public.event_feedback_forms FOR ALL
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.create')
  )
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.create')
  );

COMMENT ON TABLE public.event_feedback_forms IS
  'Post-event feedback surveys for the team that worked the event. Rendered publicly at /fb/<slug> while status = open.';

COMMENT ON COLUMN public.event_feedback_forms.schema IS
  'FeedbackSchema JSON (src/lib/feedback/schema.ts): { version, sections[{ title, fields[] }] }. Answers are keyed by field id.';

COMMENT ON COLUMN public.event_feedback_forms.is_anonymous IS
  'When true the form never asks for a name, and responses carry no respondent identity.';

-- ────────────────────────────────────────────────────────────
-- event_feedback_responses
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.event_feedback_responses (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id           uuid NOT NULL REFERENCES public.event_feedback_forms(id) ON DELETE CASCADE,
  -- Null on anonymous forms. On named forms the respondent types these
  -- in the opening step; they are not resolved against users/contacts,
  -- because volunteers frequently are neither.
  respondent_name   text,
  respondent_email  text,
  answers           jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent        text,
  submitted_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_feedback_responses_form
  ON public.event_feedback_responses (form_id, submitted_at DESC);

ALTER TABLE public.event_feedback_responses ENABLE ROW LEVEL SECURITY;

-- Reading feedback is a staff act. Inserts come from the public submit
-- route via the service-role admin client, which bypasses RLS.
CREATE POLICY "Events managers can read feedback responses"
  ON public.event_feedback_responses FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.view')
    OR public.has_permission('events.create')
  );

CREATE POLICY "Events managers can delete feedback responses"
  ON public.event_feedback_responses FOR DELETE
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.create')
  );

COMMENT ON TABLE public.event_feedback_responses IS
  'One row per submitted feedback form. answers is keyed by FeedbackField.id.';

-- ────────────────────────────────────────────────────────────
-- event_feedback_sends
-- ────────────────────────────────────────────────────────────

CREATE TABLE public.event_feedback_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id     uuid NOT NULL REFERENCES public.event_feedback_forms(id) ON DELETE CASCADE,
  to_email    text NOT NULL,
  to_name     text,
  kind        text NOT NULL DEFAULT 'invite' CHECK (kind IN ('invite', 'reminder')),
  status      text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'suppressed')),
  error       text,
  sent_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_event_feedback_sends_form ON public.event_feedback_sends (form_id, sent_at DESC);

ALTER TABLE public.event_feedback_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Events managers can read feedback sends"
  ON public.event_feedback_sends FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.view')
    OR public.has_permission('events.create')
  );

CREATE POLICY "Events managers can write feedback sends"
  ON public.event_feedback_sends FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR public.has_role('events_admin')
    OR public.has_permission('events.create')
  );

COMMENT ON TABLE public.event_feedback_sends IS
  'Audit of who the feedback link was emailed to. Powers the "remind non-responders" panel by matching to_email against response emails on named forms.';

-- ============================================================
-- Validation
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.event_feedback_forms;      -- 0
--   SELECT count(*) FROM public.event_feedback_responses;  -- 0
--   SELECT count(*) FROM public.event_feedback_sends;      -- 0
-- ============================================================
