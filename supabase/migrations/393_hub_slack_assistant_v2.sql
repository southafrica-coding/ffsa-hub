-- ============================================================
-- FFSA Hub — Migration 393: Hub Slack assistant, second slice
-- ============================================================
-- DRAFT. Not applied to any hosted database by the PR that adds
-- this file. Do not apply until Jack OKs it. Previews share prod.
--
-- Depends on 392 (slack_assistant_* tables). Apply 392 first.
--
-- The private "Hub" Slack assistant (src/lib/slack/assistant/
-- hub-leader, docs/slack/hub-assistant.md) can now also:
--   - request a vehicle booking        (create_vehicle_booking)
--   - edit a contact's details         (update_contact)
--   - approve / decline a vehicle      (decide_vehicle_booking)
--     or space booking request          (decide_space_booking)
-- each behind a button the leader presses, like the 392 actions.
-- And a problem report now carries what the assistant checked
-- before filing it (evidence).
--
--   1. slack_assistant_pending_actions.action_type accepts the four
--      new types (the CHECK from 392 is replaced, same name pattern).
--   2. slack_assistant_tickets.evidence jsonb — the read-only checks
--      the assistant ran (what it found, what it couldn't check).
--
-- No new tables, no policies change: RLS stays on, service role
-- only (392). No seed data. Nothing writes here unless
-- HUB_SLACK_ASSISTANT_ENABLED is on, and then only on the live site.
--
-- Until this is applied the new actions can't be set up (the
-- pending insert fails its CHECK, and the leader is told to try
-- later) and reports are filed without evidence; the 392 tools
-- keep working.
--
-- Idempotent. Rollback: supabase/rollbacks/393_hub_slack_assistant_v2.sql.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. New pending action types
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.slack_assistant_pending_actions
  DROP CONSTRAINT IF EXISTS slack_assistant_pending_actions_action_type_check;

ALTER TABLE public.slack_assistant_pending_actions
  ADD CONSTRAINT slack_assistant_pending_actions_action_type_check
  CHECK (action_type IN (
    'grant_permission',
    'revoke_permission',
    'resend_invite',
    'create_vehicle_booking',
    'update_contact',
    'decide_vehicle_booking',
    'decide_space_booking'
  ));

-- ────────────────────────────────────────────────────────────
-- 2. Evidence on problem reports
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.slack_assistant_tickets
  ADD COLUMN IF NOT EXISTS evidence jsonb;

COMMENT ON COLUMN public.slack_assistant_tickets.evidence IS
  'Read-only checks the Hub Slack assistant ran before filing (findings, could_not_check). Never a fix.';

-- ============================================================
-- Validation (read-only)
-- ------------------------------------------------------------
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'slack_assistant_pending_actions_action_type_check';
--     -- lists the seven types
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'slack_assistant_tickets' AND column_name = 'evidence';
--     -- 1 row
-- ============================================================
