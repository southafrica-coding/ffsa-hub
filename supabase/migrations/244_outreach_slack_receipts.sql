-- ────────────────────────────────────────────────────────────
-- 244 — Receipts from Slack
--
-- A team sends a receipt photo to the Outreach Finance bot. The original
-- file is stored straight away, Claude reads it, and the bot posts a card
-- ([Log it] [Change] [Cancel]). Nothing becomes an expense until someone
-- taps Log it.
--
--   outreach_receipt_drafts  — one row per photo sent, from the moment it
--                              arrives until it is logged or cancelled.
--                              Kept afterwards as the audit trail of what
--                              was sent, read and decided, and by whom.
--   outreach_expenses.source — where an expense came from (hub / import /
--                              slack), so finance can tell at a glance.
--   outreach_receipts.file_sha256 — fingerprint of the stored file, so
--                              the same photo sent twice is caught.
--
-- Drafts are written only by the server (service role); RLS lets finance
-- staff and the team read them.
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.outreach_receipt_drafts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id         uuid NOT NULL REFERENCES public.outreach_teams(id) ON DELETE CASCADE,
  hub_user_id     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  slack_user_id   text NOT NULL,
  channel_id      text NOT NULL,
  thread_ts       text,
  card_ts         text,                  -- the bot's card message, updated on decision
  user_note       text,                  -- what they typed with the photo
  -- The original file, exactly as sent.
  slack_file_id   text,
  file_name       text NOT NULL,
  mime_type       text,
  file_size       integer,
  file_sha256     text NOT NULL,
  storage_path    text NOT NULL,         -- outreach-receipts bucket
  -- What Claude read, and what the card proposes (editable via Change).
  extracted       jsonb,
  proposal        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('reading', 'pending', 'logging', 'logged', 'cancelled', 'failed')),
  expense_id      uuid REFERENCES public.outreach_expenses(id) ON DELETE SET NULL,
  decided_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at      timestamptz,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ord_team ON public.outreach_receipt_drafts(team_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ord_sha ON public.outreach_receipt_drafts(team_id, file_sha256);

ALTER TABLE public.outreach_receipt_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read receipt drafts" ON public.outreach_receipt_drafts;
CREATE POLICY "Read receipt drafts"
  ON public.outreach_receipt_drafts FOR SELECT
  USING (
    public.is_admin()
    OR public.has_role('finance_admin')
    OR public.has_permission('finance.view')
    OR public.has_permission('finance.edit')
    OR public.is_outreach_team_member(team_id)
  );

-- ── Where an expense came from ──────────────────────────────
ALTER TABLE public.outreach_expenses
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'hub';

UPDATE public.outreach_expenses SET source = 'import'
WHERE import_batch_id IS NOT NULL AND source = 'hub';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'outreach_expenses_source_check'
  ) THEN
    ALTER TABLE public.outreach_expenses
      ADD CONSTRAINT outreach_expenses_source_check CHECK (source IN ('hub', 'import', 'slack'));
  END IF;
END $$;

-- ── Receipt file fingerprints ───────────────────────────────
ALTER TABLE public.outreach_receipts
  ADD COLUMN IF NOT EXISTS file_sha256 text;

CREATE INDEX IF NOT EXISTS idx_or_sha ON public.outreach_receipts(file_sha256)
  WHERE file_sha256 IS NOT NULL;
