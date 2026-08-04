-- 152_campaign_drip_pg_cron.sql
--
-- Drives throttled campaign sending. The app's /api/cron/send-scheduled endpoint
-- sends one throttled batch per call and resumes any in-progress campaign; to
-- drip a large audience out under Mailtrap's hourly limit it must be called
-- frequently. Vercel's Hobby plan caps cron at once/day, so we drive it from
-- Supabase pg_cron instead (every 5 minutes) via an HTTP call with pg_net.
--
-- ── ONE-TIME SETUP (run once in the SQL editor; NOT stored in source) ─────────
-- Store the app URL and the cron bearer secret in Supabase Vault. The secret
-- MUST equal the CRON_SECRET env var set on the Vercel deployment, or the
-- endpoint returns 401 and nothing sends.
--
--   select vault.create_secret('https://www.ffsahub.com', 'ffsa_app_url',
--     'Base URL of the FFSA Hub app, for pg_cron HTTP calls');
--   select vault.create_secret('<the CRON_SECRET value>', 'ffsa_cron_secret',
--     'Bearer token for the send-scheduled cron endpoint');
--
-- To rotate later: select vault.update_secret(id, '<new value>') — no code change.
-- ──────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-runnable: drop any prior definition before (re)scheduling.
select cron.unschedule('campaign-drip-send')
where exists (select 1 from cron.job where jobname = 'campaign-drip-send');

-- Every 5 minutes, ping the send-scheduled endpoint. It is idempotent and
-- self-throttling: it sends only up to the remaining hourly budget and skips
-- when the budget is spent, so calling it often is safe. Reads URL + secret
-- from Vault so no secret lives in this file.
select cron.schedule(
  'campaign-drip-send',
  '*/5 * * * *',
  $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets
            where name = 'ffsa_app_url') || '/api/cron/send-scheduled',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                    where name = 'ffsa_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $job$
);
