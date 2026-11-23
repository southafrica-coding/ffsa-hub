-- Rollback for 392_hub_slack_assistant.sql. Only drops what 392 added.
DROP TABLE IF EXISTS public.slack_assistant_audit_log;
DROP TABLE IF EXISTS public.slack_assistant_tickets;
DROP TABLE IF EXISTS public.slack_assistant_pending_actions;
