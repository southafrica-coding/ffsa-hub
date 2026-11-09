-- ============================================================
-- FFSA Hub — Migration 314: event-scoped events.* permissions
-- ============================================================
-- Builds on 313 (#542). An events.* grant with scope_type = 'event'
-- (user_permissions or user_roles) now counts only for that event.
-- Unscoped grants, admin and the events_admin / comms_admin /
-- finance_admin roles stay global. Nobody gains access.
--
-- Helper: public.has_event_permission(key, event_id)
--   active account (users.is_active IS NOT FALSE, as 313)
--   AND ( unscoped grant of key
--         OR event-scoped grant of key for this event
--         OR the caller created this event AND holds key in some event
--            scope — so a scoped creator can run an event they created )
--   event_id NULL => only the unscoped grant counts.
-- has_permission_for is NOT extended: its callers pass program ids and
-- its role/direct branches match scope_type = 'program'; event ids would
-- be a different meaning for the same argument.
--
-- Set form: public.permitted_event_ids(key) returns the events for which
-- has_event_permission(key, id) is true. Policies use it as
--   (SELECT <roles> OR has_event_permission(key, NULL))   -- initplan, once
--   OR event_id IN (SELECT public.permitted_event_ids(key)) -- hashed, once
-- so nothing heavy runs per row (a per-row has_event_permission call
-- costs ~0.3 ms: 3-7 s on the 11k email_messages rows, measured on prod).
--
-- Child tables without event_id resolve it through definer lookups
-- (event_id_of_order / _feedback_form / _outcome / _form). They return
-- NULL for a caller with no auth.uid() (anon), so they reveal nothing.
--
-- Semantics where no event exists yet / no event id:
--   * events INSERT: unscoped events.create (or admin/events_admin) as
--     before; an event-scoped events.create holder may still create an
--     event, but only as created_by = themselves. They then manage it
--     through created_by (existing UPDATE/SELECT clauses) and the
--     creator arm of has_event_permission.
--   * forms / form_submissions with no event: unchanged (comms only).
--   * email_messages with no event and no order: unscoped events.view.
--   * payment_fee_profiles (3 global fee rows) and finance_org_choices()
--     (org names for the event form): unchanged, any active holder of the
--     key in any scope — scoped editors need them to price/attach their
--     own event, and neither returns event data.
-- Idempotent: CREATE OR REPLACE functions; DROP POLICY IF EXISTS + CREATE
-- with the live names, roles (public) and permissive mode.
-- ============================================================

CREATE OR REPLACE FUNCTION public.has_event_permission(required_permission text, target_event_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.is_active IS NOT FALSE
  )
  AND (
    EXISTS (
      SELECT 1
      FROM public.user_permissions up
      JOIN public.permissions p ON p.id = up.permission_id
      WHERE up.user_id = auth.uid()
        AND p.key = required_permission
        AND (up.scope_type IS NULL
             OR (up.scope_type = 'event' AND up.scope_id = target_event_id))
    )
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = auth.uid()
        AND p.key = required_permission
        AND (ur.scope_type IS NULL
             OR (ur.scope_type = 'event' AND ur.scope_id = target_event_id))
    )
    OR (
      EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.id = target_event_id AND e.created_by = auth.uid()
      )
      AND (
        EXISTS (
          SELECT 1
          FROM public.user_permissions up
          JOIN public.permissions p ON p.id = up.permission_id
          WHERE up.user_id = auth.uid()
            AND p.key = required_permission
            AND up.scope_type = 'event'
        )
        OR EXISTS (
          SELECT 1
          FROM public.user_roles ur
          JOIN public.role_permissions rp ON rp.role_id = ur.role_id
          JOIN public.permissions p ON p.id = rp.permission_id
          WHERE ur.user_id = auth.uid()
            AND p.key = required_permission
            AND ur.scope_type = 'event'
        )
      )
    )
  );
$$;

COMMENT ON FUNCTION public.has_event_permission(text, uuid) IS
  'True for an active caller with the key unscoped, scoped to this event, or scoped to some event when they created this one. NULL event: unscoped only. (314)';

CREATE OR REPLACE FUNCTION public.permitted_event_ids(required_permission text)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.id FROM public.events e
  WHERE public.has_event_permission(required_permission, e.id);
$$;

COMMENT ON FUNCTION public.permitted_event_ids(text) IS
  'Events for which has_event_permission(key, id) is true for the caller. Used by RLS as event_id IN (SELECT ...). (314)';

CREATE OR REPLACE FUNCTION public.event_id_of_order(p_order_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT o.event_id FROM public.orders o WHERE o.id = p_order_id AND auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.event_id_of_feedback_form(p_form_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT f.event_id FROM public.event_feedback_forms f WHERE f.id = p_form_id AND auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.event_id_of_outcome(p_outcome_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT o.event_id FROM public.event_outcomes o WHERE o.id = p_outcome_id AND auth.uid() IS NOT NULL; $$;

CREATE OR REPLACE FUNCTION public.event_id_of_form(p_form_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$ SELECT f.event_id FROM public.forms f WHERE f.id = p_form_id AND auth.uid() IS NOT NULL; $$;

-- Same EXECUTE pattern as has_permission_for (PUBLIC, anon, authenticated,
-- service_role): the policies below are TO public and anon-readable ones
-- (open feedback forms, active forms) evaluate these for anon; without
-- EXECUTE anon would get 42501 instead of the public rows.
GRANT EXECUTE ON FUNCTION public.has_event_permission(text, uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.permitted_event_ids(text) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.event_id_of_order(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.event_id_of_feedback_form(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.event_id_of_outcome(uuid) TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.event_id_of_form(uuid) TO PUBLIC, anon, authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- Policies (live names; only has_permission('events.*') arms change)
-- ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "Admins and events admins can create events" ON public.events;
CREATE POLICY "Admins and events admins can create events"
  ON public.events FOR INSERT
  WITH CHECK (public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL) OR (created_by = auth.uid() AND public.has_permission('events.create')));

DROP POLICY IF EXISTS "Admins and events admins can update events" ON public.events;
CREATE POLICY "Admins and events admins can update events"
  ON public.events FOR UPDATE
  USING ((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR created_by = auth.uid() OR id IN (SELECT public.permitted_event_ids('events.create')))
  WITH CHECK ((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR created_by = auth.uid() OR id IN (SELECT public.permitted_event_ids('events.create')));

DROP POLICY IF EXISTS "Admins can read all events" ON public.events;
CREATE POLICY "Admins can read all events"
  ON public.events FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL)) OR id IN (SELECT public.permitted_event_ids('events.view'))));

DROP POLICY IF EXISTS "Admins can create registrations" ON public.event_registrations;
CREATE POLICY "Admins can create registrations"
  ON public.event_registrations FOR INSERT
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_registrations'))));

DROP POLICY IF EXISTS "Admins can read all registrations" ON public.event_registrations;
CREATE POLICY "Admins can read all registrations"
  ON public.event_registrations FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view'))));

DROP POLICY IF EXISTS "Admins can update registrations" ON public.event_registrations;
CREATE POLICY "Admins can update registrations"
  ON public.event_registrations FOR UPDATE
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_registrations'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_registrations'))));

DROP POLICY IF EXISTS "Admins, events, finance can manage orders" ON public.orders;
CREATE POLICY "Admins, events, finance can manage orders"
  ON public.orders FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_registrations'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_registrations'))));

DROP POLICY IF EXISTS "Admins, events, finance can read orders" ON public.orders;
CREATE POLICY "Admins, events, finance can read orders"
  ON public.orders FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.view', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view'))));

DROP POLICY IF EXISTS "Admins, events, finance can manage order refunds" ON public.order_refunds;
CREATE POLICY "Admins, events, finance can manage order refunds"
  ON public.order_refunds FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR public.event_id_of_order(order_id) IN (SELECT public.permitted_event_ids('events.manage_registrations'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.manage_registrations', NULL)) OR public.event_id_of_order(order_id) IN (SELECT public.permitted_event_ids('events.manage_registrations'))));

DROP POLICY IF EXISTS "Admins, events, finance can read order refunds" ON public.order_refunds;
CREATE POLICY "Admins, events, finance can read order refunds"
  ON public.order_refunds FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.view', NULL)) OR public.event_id_of_order(order_id) IN (SELECT public.permitted_event_ids('events.view'))));

DROP POLICY IF EXISTS "Admins and events can manage tickets" ON public.tickets;
CREATE POLICY "Admins and events can manage tickets"
  ON public.tickets FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.manage_attendance', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_attendance'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.manage_attendance', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_attendance'))));

DROP POLICY IF EXISTS "Admins and events can read tickets" ON public.tickets;
CREATE POLICY "Admins and events can read tickets"
  ON public.tickets FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view'))));

DROP POLICY IF EXISTS "Admins and events can manage ticket types" ON public.ticket_types;
CREATE POLICY "Admins and events can manage ticket types"
  ON public.ticket_types FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Admins and events can manage promo codes" ON public.promo_codes;
CREATE POLICY "Admins and events can manage promo codes"
  ON public.promo_codes FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Admins and events can read promo codes" ON public.promo_codes;
CREATE POLICY "Admins and events can read promo codes"
  ON public.promo_codes FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view'))));

DROP POLICY IF EXISTS "Admins and events can manage event roles" ON public.event_roles;
CREATE POLICY "Admins and events can manage event roles"
  ON public.event_roles FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Admins and events can manage event outcomes" ON public.event_outcomes;
CREATE POLICY "Admins and events can manage event outcomes"
  ON public.event_outcomes FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('comms_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('comms_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Admins and events can manage outcome responses" ON public.event_outcome_responses;
CREATE POLICY "Admins and events can manage outcome responses"
  ON public.event_outcome_responses FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('comms_admin') OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_outcome(outcome_id) IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('comms_admin') OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_outcome(outcome_id) IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Admins and events can manage outcome workflows" ON public.outcome_workflows;
CREATE POLICY "Admins and events can manage outcome workflows"
  ON public.outcome_workflows FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('comms_admin') OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_outcome(outcome_id) IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('comms_admin') OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_outcome(outcome_id) IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Event editors can add event labels" ON public.event_labels;
CREATE POLICY "Event editors can add event labels"
  ON public.event_labels FOR INSERT
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Event editors can remove event labels" ON public.event_labels;
CREATE POLICY "Event editors can remove event labels"
  ON public.event_labels FOR DELETE
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Event viewers can read event labels" ON public.event_labels;
CREATE POLICY "Event viewers can read event labels"
  ON public.event_labels FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL) OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view')) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Attendance managers manage scan links" ON public.event_scan_links;
CREATE POLICY "Attendance managers manage scan links"
  ON public.event_scan_links FOR ALL
  USING (((SELECT public.is_admin() OR public.has_event_permission('events.manage_attendance', NULL) OR public.has_event_permission('events.manage', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_attendance')) OR event_id IN (SELECT public.permitted_event_ids('events.manage'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_event_permission('events.manage_attendance', NULL) OR public.has_event_permission('events.manage', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.manage_attendance')) OR event_id IN (SELECT public.permitted_event_ids('events.manage'))));

DROP POLICY IF EXISTS "Events managers can manage feedback forms" ON public.event_feedback_forms;
CREATE POLICY "Events managers can manage feedback forms"
  ON public.event_feedback_forms FOR ALL
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))))
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Open feedback forms readable by anyone" ON public.event_feedback_forms;
CREATE POLICY "Open feedback forms readable by anyone"
  ON public.event_feedback_forms FOR SELECT
  USING (status = 'open' OR ((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL) OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view')) OR event_id IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Events managers can delete feedback responses" ON public.event_feedback_responses;
CREATE POLICY "Events managers can delete feedback responses"
  ON public.event_feedback_responses FOR DELETE
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_feedback_form(form_id) IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Events managers can read feedback responses" ON public.event_feedback_responses;
CREATE POLICY "Events managers can read feedback responses"
  ON public.event_feedback_responses FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL) OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_feedback_form(form_id) IN (SELECT public.permitted_event_ids('events.view')) OR public.event_id_of_feedback_form(form_id) IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Events managers can read feedback sends" ON public.event_feedback_sends;
CREATE POLICY "Events managers can read feedback sends"
  ON public.event_feedback_sends FOR SELECT
  USING (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.view', NULL) OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_feedback_form(form_id) IN (SELECT public.permitted_event_ids('events.view')) OR public.event_id_of_feedback_form(form_id) IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Events managers can write feedback sends" ON public.event_feedback_sends;
CREATE POLICY "Events managers can write feedback sends"
  ON public.event_feedback_sends FOR INSERT
  WITH CHECK (((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_feedback_form(form_id) IN (SELECT public.permitted_event_ids('events.create'))));

DROP POLICY IF EXISTS "Active forms readable by anyone" ON public.forms;
CREATE POLICY "Active forms readable by anyone"
  ON public.forms FOR SELECT
  USING (is_active = true OR (SELECT public.is_admin() OR public.has_role('comms_admin')) OR (event_id IS NOT NULL AND ((SELECT public.has_event_permission('events.view', NULL) OR public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.view')) OR event_id IN (SELECT public.permitted_event_ids('events.create')))));

DROP POLICY IF EXISTS "Admins and comms can manage forms" ON public.forms;
CREATE POLICY "Admins and comms can manage forms"
  ON public.forms FOR ALL
  USING ((SELECT public.is_admin() OR public.has_role('comms_admin')) OR (event_id IS NOT NULL AND ((SELECT public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create')))))
  WITH CHECK ((SELECT public.is_admin() OR public.has_role('comms_admin')) OR (event_id IS NOT NULL AND ((SELECT public.has_event_permission('events.create', NULL)) OR event_id IN (SELECT public.permitted_event_ids('events.create')))));

DROP POLICY IF EXISTS "Admins and comms can insert submissions" ON public.form_submissions;
CREATE POLICY "Admins and comms can insert submissions"
  ON public.form_submissions FOR INSERT
  WITH CHECK ((SELECT public.is_admin() OR public.has_role('comms_admin')) OR (public.event_id_of_form(form_id) IS NOT NULL AND ((SELECT public.has_event_permission('events.create', NULL)) OR public.event_id_of_form(form_id) IN (SELECT public.permitted_event_ids('events.create')))));

DROP POLICY IF EXISTS "Admins and comms can read submissions" ON public.form_submissions;
CREATE POLICY "Admins and comms can read submissions"
  ON public.form_submissions FOR SELECT
  USING ((SELECT public.is_admin() OR public.has_role('comms_admin')) OR (public.event_id_of_form(form_id) IS NOT NULL AND ((SELECT public.has_event_permission('events.view', NULL) OR public.has_event_permission('events.create', NULL)) OR public.event_id_of_form(form_id) IN (SELECT public.permitted_event_ids('events.view')) OR public.event_id_of_form(form_id) IN (SELECT public.permitted_event_ids('events.create')))));

DROP POLICY IF EXISTS "Staff can read email messages" ON public.email_messages;
CREATE POLICY "Staff can read email messages"
  ON public.email_messages FOR SELECT
  USING ((SELECT public.is_admin() OR public.has_role('events_admin') OR public.has_role('finance_admin') OR public.has_event_permission('events.view', NULL) OR public.has_permission('communications.view') OR public.has_permission('contacts.view')) OR event_id IN (SELECT public.permitted_event_ids('events.view')) OR (event_id IS NULL AND public.event_id_of_order(order_id) IN (SELECT public.permitted_event_ids('events.view'))));

-- finance_org_choices() and payment_fee_profiles "Admins, finance, events
-- can read fee profiles" are intentionally unchanged (see header).
