-- ────────────────────────────────────────────────────────────
-- 248 — "Running low" alerts for money sent to outreach teams
--
-- School leaders at base watch how much of the money SENT to a team is
-- still unspent, so they can send more in time. When that drops to the
-- team's low level (default 30%) and again at critical (default 15%),
-- the team's school leaders get a Slack DM from Outreach Finance.
--
--   cash_alert_low_pct / cash_alert_critical_pct — per-team levels
--   cash_alert_level   — the last level alerted ('ok' | 'low' |
--                        'critical'), so each level alerts once; sending
--                        more money resets it to 'ok'
--   cash_alert_at      — when the last alert went out
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.outreach_teams
  ADD COLUMN IF NOT EXISTS cash_alert_low_pct integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS cash_alert_critical_pct integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS cash_alert_level text,
  ADD COLUMN IF NOT EXISTS cash_alert_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outreach_teams_cash_alert_pcts_check') THEN
    ALTER TABLE public.outreach_teams
      ADD CONSTRAINT outreach_teams_cash_alert_pcts_check
      CHECK (cash_alert_critical_pct BETWEEN 0 AND 100
             AND cash_alert_low_pct BETWEEN 0 AND 100
             AND cash_alert_critical_pct <= cash_alert_low_pct);
  END IF;
END $$;
