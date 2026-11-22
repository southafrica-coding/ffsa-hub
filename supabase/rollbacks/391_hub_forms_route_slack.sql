-- Rollback for 391_hub_forms_route_slack.sql. Only drops what 391 added.
DROP TABLE IF EXISTS public.form_route_slack_messages;
