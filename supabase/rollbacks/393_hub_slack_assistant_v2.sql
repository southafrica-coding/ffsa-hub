-- Rollback for 393_hub_slack_assistant_v2.sql. Only undoes what 393 added.
-- Pending rows of the new types would break the old CHECK, so close them first.
DELETE FROM public.slack_assistant_pending_actions
 WHERE action_type IN ('create_vehicle_booking', 'update_contact', 'decide_vehicle_booking', 'decide_space_booking');

ALTER TABLE public.slack_assistant_pending_actions
  DROP CONSTRAINT IF EXISTS slack_assistant_pending_actions_action_type_check;
ALTER TABLE public.slack_assistant_pending_actions
  ADD CONSTRAINT slack_assistant_pending_actions_action_type_check
  CHECK (action_type IN ('grant_permission', 'revoke_permission', 'resend_invite'));

ALTER TABLE public.slack_assistant_tickets DROP COLUMN IF EXISTS evidence;
