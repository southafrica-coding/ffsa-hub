-- ────────────────────────────────────────────────────────────
-- 261 — Outreach money alerts go to one assigned school leader
--
-- The low-cash Slack alert (migration 248) went to every owner and
-- co-leader. Now each team names the one person who gets it — normally
-- the school leader, who needn't be on the team. Nobody named, nobody
-- alerted. Set from the team's Money alerts box by the owner, co-leaders
-- or finance staff (the outreach_teams update policy, migration 260).
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_teams
  ADD COLUMN IF NOT EXISTS cash_alert_user_id uuid
  REFERENCES public.users(id) ON DELETE SET NULL;
