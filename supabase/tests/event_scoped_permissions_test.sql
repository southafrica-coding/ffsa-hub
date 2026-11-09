-- Disposable check for migration 314 (event-scoped events.* permissions).
-- Not a migration. Runs against a throwaway database with the real schema
-- (304–309, 307, 312, 313, 314 applied). One transaction, rolled back.
-- Never point this at a shared or remote database.
--
--   psql -v ON_ERROR_STOP=1 -d <throwaway> -f supabase/tests/event_scoped_permissions_test.sql
--
-- People (event A, event B):
--   sA     every events.* key scoped to event A (direct grants)
--   cA     events.create scoped to A only (the common prod shape)
--   rA     events.manage_registrations + manage_attendance scoped to A via a role
--   gH     every events.* key unscoped
--   fin    finance_admin role (unscoped)
--   adm    admin role
--   off    deactivated (is_active = false), every events.* key unscoped
--   nobody signed in, no grants
--   anon   not signed in
\set ON_ERROR_STOP 1
SET client_min_messages = notice;
BEGIN;

CREATE TEMP TABLE t314 (n serial, label text, got text, want text);
GRANT ALL ON t314 TO PUBLIC;
GRANT USAGE ON SEQUENCE t314_n_seq TO PUBLIC;

DO $$
DECLARE
  ids jsonb := '{}'::jsonb;
  who text;
  ev jsonb := '{}'::jsonb;
  s text;
  k text;
  r_adm uuid; r_fin uuid; r_scoped uuid;
  e uuid; c uuid; c2 uuid; o uuid; xid uuid; tt uuid; ou uuid; ff uuid; fm uuid; lb uuid;
BEGIN
  FOREACH who IN ARRAY ARRAY['sA','cA','rA','gH','fin','adm','off','nobody'] LOOP
    ids := ids || jsonb_build_object(who, gen_random_uuid());
    INSERT INTO auth.users (id, email) VALUES ((ids->>who)::uuid, who || '@t314.test');
    INSERT INTO public.users (id, email, first_name, last_name, is_active)
    VALUES ((ids->>who)::uuid, who || '@t314.test', who, 'T314', who <> 'off');
  END LOOP;

  INSERT INTO public.roles (name, display_name) VALUES
    ('admin', 'Admin'), ('finance_admin', 'Finance Admin'), ('t314_scoped_ops', 'T314 scoped ops')
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO r_adm FROM public.roles WHERE name = 'admin';
  SELECT id INTO r_fin FROM public.roles WHERE name = 'finance_admin';
  SELECT id INTO r_scoped FROM public.roles WHERE name = 't314_scoped_ops';
  INSERT INTO public.permissions (module, key, display_name) VALUES
    ('events', 'events.view', 'View events'),
    ('events', 'events.create', 'Create events'),
    ('events', 'events.manage_registrations', 'Manage registrations'),
    ('events', 'events.manage_attendance', 'Manage attendance'),
    ('events', 'events.manage', 'Manage events')
  ON CONFLICT (key) DO NOTHING;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r_scoped, id FROM public.permissions
   WHERE key IN ('events.manage_registrations', 'events.manage_attendance')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.contacts (first_name, last_name) VALUES ('T314', 'Contact') RETURNING id INTO c;
  INSERT INTO public.contacts (first_name, last_name) VALUES ('T314', 'Contact2') RETURNING id INTO c2;
  ev := ev || jsonb_build_object('c2', c2);
  INSERT INTO public.labels (name, slug) VALUES ('t314 label', 't314-label-' || left(gen_random_uuid()::text, 6)) RETURNING id INTO lb;

  FOREACH s IN ARRAY ARRAY['A','B'] LOOP
    INSERT INTO public.events (title, start_date, created_by)
    VALUES ('t314 ' || s, current_date + 30, (ids->>'adm')::uuid) RETURNING id INTO e;
    ev := ev || jsonb_build_object('ev' || s, e);
    INSERT INTO public.orders (event_id, buyer_first_name, buyer_last_name, buyer_email)
    VALUES (e, 'B', s, 'buyer' || s || '@t314.test') RETURNING id INTO o;
    ev := ev || jsonb_build_object('o' || s, o);
    INSERT INTO public.ticket_types (event_id, name) VALUES (e, 'GA ' || s) RETURNING id INTO tt;
    ev := ev || jsonb_build_object('tt' || s, tt);
    INSERT INTO public.tickets (order_id, event_id, ticket_type_id, code)
      VALUES (o, e, tt, 'T314' || s || left(gen_random_uuid()::text, 6)) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('t' || s, xid);
    INSERT INTO public.promo_codes (event_id, code, kind, percent_off)
      VALUES (e, 'T314' || s, 'percent', 10) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('pc' || s, xid);
    INSERT INTO public.event_registrations (contact_id, event_id) VALUES (c, e) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('reg' || s, xid);
    INSERT INTO public.order_refunds (order_id, amount_cents) VALUES (o, 100) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('rf' || s, xid);
    INSERT INTO public.event_outcomes (event_id, name) VALUES (e, 'Outcome ' || s) RETURNING id INTO ou;
    ev := ev || jsonb_build_object('ou' || s, ou);
    INSERT INTO public.event_outcome_responses (outcome_id, contact_id) VALUES (ou, c) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('our' || s, xid);
    INSERT INTO public.outcome_workflows (outcome_id, name) VALUES (ou, 'WF ' || s) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('wf' || s, xid);
    INSERT INTO public.event_labels (event_id, label_id) VALUES (e, lb);
    INSERT INTO public.event_scan_links (event_id, token) VALUES (e, 't314' || s || gen_random_uuid()) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('sl' || s, xid);
    INSERT INTO public.event_feedback_forms (event_id, slug, title, status)
    VALUES (e, 't314-fb-' || lower(s) || left(gen_random_uuid()::text, 6), 'Feedback ' || s, 'draft') RETURNING id INTO ff;
    ev := ev || jsonb_build_object('ff' || s, ff);
    INSERT INTO public.event_feedback_responses (form_id) VALUES (ff) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('ffr' || s, xid);
    INSERT INTO public.event_feedback_sends (form_id, to_email) VALUES (ff, 'fb' || s || '@t314.test') RETURNING id INTO xid;
    ev := ev || jsonb_build_object('ffs' || s, xid);
    INSERT INTO public.forms (slug, name, schema, event_id, is_active)
    VALUES ('t314-form-' || lower(s) || left(gen_random_uuid()::text, 6), 'Form ' || s, '{}'::jsonb, e, false) RETURNING id INTO fm;
    ev := ev || jsonb_build_object('fm' || s, fm);
    INSERT INTO public.form_submissions (form_id, raw_data, dedup_action) VALUES (fm, '{}'::jsonb, 'new') RETURNING id INTO xid;
    ev := ev || jsonb_build_object('fs' || s, xid);
    INSERT INTO public.email_messages (to_email, provider, event_id) VALUES ('m' || s || '@t314.test', 'resend', e) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('em' || s, xid);
    INSERT INTO public.email_messages (to_email, provider, order_id) VALUES ('mo' || s || '@t314.test', 'resend', o) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('emo' || s, xid);
  END LOOP;
  -- Public rows on B: an open feedback form and an active form.
  INSERT INTO public.event_feedback_forms (event_id, slug, title, status)
    VALUES ((ev->>'evB')::uuid, 't314-open-' || left(gen_random_uuid()::text, 6), 'Open B', 'open') RETURNING id INTO xid;
    ev := ev || jsonb_build_object('ffOpenB', xid);
  INSERT INTO public.forms (slug, name, schema, event_id, is_active)
    VALUES ('t314-act-' || left(gen_random_uuid()::text, 6), 'Active B', '{}'::jsonb, (ev->>'evB')::uuid, true) RETURNING id INTO xid;
    ev := ev || jsonb_build_object('fmActB', xid);
  INSERT INTO public.email_messages (to_email, provider) VALUES ('none@t314.test', 'resend') RETURNING id INTO xid;
    ev := ev || jsonb_build_object('emNone', xid);
  INSERT INTO public.finance_orgs (key, name, xero_region, record_currency, projects_category_name, is_active)
  VALUES ('npc', 'T314 Org', 'za', 'ZAR', 'Projects', true) ON CONFLICT DO NOTHING;

  INSERT INTO public.user_roles (user_id, role_id, scope_type, scope_id) VALUES
    ((ids->>'adm')::uuid, r_adm, NULL, NULL),
    ((ids->>'fin')::uuid, r_fin, NULL, NULL),
    ((ids->>'rA')::uuid, r_scoped, 'event', (ev->>'evA')::uuid);
  FOREACH k IN ARRAY ARRAY['events.view','events.create','events.manage_registrations','events.manage_attendance','events.manage'] LOOP
    INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
    SELECT (ids->>x.who)::uuid, p.id, x.st, x.sid
    FROM (VALUES ('sA', 'event', (ev->>'evA')::uuid), ('gH', NULL, NULL), ('off', NULL, NULL)) AS x(who, st, sid)
    JOIN public.permissions p ON p.key = k;
  END LOOP;
  INSERT INTO public.user_permissions (user_id, permission_id, scope_type, scope_id)
  SELECT (ids->>'cA')::uuid, id, 'event', (ev->>'evA')::uuid FROM public.permissions WHERE key = 'events.create';

  PERFORM set_config('t314.ids', ids::text, false);
  PERFORM set_config('t314.ev', ev::text, false);
END $$;

CREATE FUNCTION pg_temp.id(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT (current_setting('t314.ev')::jsonb->>k)::uuid;
$$;
CREATE FUNCTION pg_temp.uid(k text) RETURNS uuid LANGUAGE sql AS $$
  SELECT (current_setting('t314.ids')::jsonb->>k)::uuid;
$$;

CREATE FUNCTION pg_temp.as_who(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF who = 'anon' THEN
    PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
    EXECUTE 'SET LOCAL ROLE anon';
  ELSE
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', current_setting('t314.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
    EXECUTE 'SET LOCAL ROLE authenticated';
  END IF;
END $$;

-- Run one statement as a person and report rows affected or SQLSTATE.
-- Everything is rolled back by the RAISE.
CREATE FUNCTION pg_temp.try(who text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; res text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_who(who);
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0314', MESSAGE = 'rows=' || n;
  EXCEPTION WHEN SQLSTATE 'P0314' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  RETURN res;
END $$;

-- Run a statement as a person, then evaluate chk as owner, then roll back.
CREATE FUNCTION pg_temp.unf(who text, stmt text, chk text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_who(who);
    EXECUTE stmt;
    RESET ROLE;
    EXECUTE chk INTO v;
    RAISE EXCEPTION USING ERRCODE = 'P0314', MESSAGE = coalesce(v, 'null');
  EXCEPTION WHEN SQLSTATE 'P0314' THEN v := SQLERRM;
            WHEN OTHERS THEN v := 'err ' || SQLSTATE;
  END;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.fn(who text, expr text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_who(who);
    EXECUTE 'SELECT (' || expr || ')::text' INTO v;
    RAISE EXCEPTION USING ERRCODE = 'P0314', MESSAGE = coalesce(v, 'null');
  EXCEPTION WHEN SQLSTATE 'P0314' THEN v := SQLERRM;
            WHEN OTHERS THEN v := 'err ' || SQLSTATE;
  END;
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t314 (label, got, want) VALUES (label, got, want);
$$;

-- sel/upd/del on one row by id; expect for A and B in one call.
CREATE FUNCTION pg_temp.sel(who text, tbl text, k text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(who, format('SELECT 1 FROM public.%I WHERE id = %L', tbl, pg_temp.id(k)));
$$;
CREATE FUNCTION pg_temp.upd(who text, tbl text, k text, col text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(who, format('UPDATE public.%I SET %I = %I WHERE id = %L', tbl, col, col, pg_temp.id(k)));
$$;
CREATE FUNCTION pg_temp.del(who text, tbl text, k text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(who, format('DELETE FROM public.%I WHERE id = %L', tbl, pg_temp.id(k)));
$$;
CREATE FUNCTION pg_temp.ab(label text, who text, f text, tbl text, kA text, kB text, wantA text, wantB text, col text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF f = 'sel' THEN
    PERFORM pg_temp.expect(label || ' A', pg_temp.sel(who, tbl, kA), wantA);
    PERFORM pg_temp.expect(label || ' B', pg_temp.sel(who, tbl, kB), wantB);
  ELSIF f = 'upd' THEN
    PERFORM pg_temp.expect(label || ' A', pg_temp.upd(who, tbl, kA, col), wantA);
    PERFORM pg_temp.expect(label || ' B', pg_temp.upd(who, tbl, kB, col), wantB);
  ELSE
    PERFORM pg_temp.expect(label || ' A', pg_temp.del(who, tbl, kA), wantA);
    PERFORM pg_temp.expect(label || ' B', pg_temp.del(who, tbl, kB), wantB);
  END IF;
END $$;

-- ── 1. sA: everything on A, nothing on B (B rows are invisible, so 0 rows) ──
SELECT pg_temp.ab('sA events SELECT',            'sA', 'sel', 'events', 'evA', 'evB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA events UPDATE',            'sA', 'upd', 'events', 'evA', 'evB', 'rows=1', 'rows=0', 'title');
SELECT pg_temp.ab('sA registrations SELECT',     'sA', 'sel', 'event_registrations', 'regA', 'regB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA registrations UPDATE',     'sA', 'upd', 'event_registrations', 'regA', 'regB', 'rows=1', 'rows=0', 'status');
SELECT pg_temp.ab('sA orders SELECT',            'sA', 'sel', 'orders', 'oA', 'oB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA orders UPDATE',            'sA', 'upd', 'orders', 'oA', 'oB', 'rows=1', 'rows=0', 'status');
SELECT pg_temp.ab('sA orders DELETE',            'sA', 'del', 'orders', 'oA', 'oB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA refunds SELECT',           'sA', 'sel', 'order_refunds', 'rfA', 'rfB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA refunds UPDATE',           'sA', 'upd', 'order_refunds', 'rfA', 'rfB', 'rows=1', 'rows=0', 'status');
SELECT pg_temp.ab('sA tickets SELECT',           'sA', 'sel', 'tickets', 'tA', 'tB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA tickets UPDATE',           'sA', 'upd', 'tickets', 'tA', 'tB', 'rows=1', 'rows=0', 'status');
SELECT pg_temp.ab('sA tickets DELETE',           'sA', 'del', 'tickets', 'tA', 'tB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA ticket_types UPDATE',      'sA', 'upd', 'ticket_types', 'ttA', 'ttB', 'rows=1', 'rows=0', 'name');
SELECT pg_temp.ab('sA promo SELECT',             'sA', 'sel', 'promo_codes', 'pcA', 'pcB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA promo DELETE',             'sA', 'del', 'promo_codes', 'pcA', 'pcB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA outcomes UPDATE',          'sA', 'upd', 'event_outcomes', 'ouA', 'ouB', 'rows=1', 'rows=0', 'name');
SELECT pg_temp.ab('sA outcome responses DELETE', 'sA', 'del', 'event_outcome_responses', 'ourA', 'ourB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA workflows UPDATE',         'sA', 'upd', 'outcome_workflows', 'wfA', 'wfB', 'rows=1', 'rows=0', 'name');
SELECT pg_temp.ab('sA scan links UPDATE',        'sA', 'upd', 'event_scan_links', 'slA', 'slB', 'rows=1', 'rows=0', 'token');
SELECT pg_temp.ab('sA feedback forms UPDATE',    'sA', 'upd', 'event_feedback_forms', 'ffA', 'ffB', 'rows=1', 'rows=0', 'title');
SELECT pg_temp.ab('sA feedback resp SELECT',     'sA', 'sel', 'event_feedback_responses', 'ffrA', 'ffrB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA feedback resp DELETE',     'sA', 'del', 'event_feedback_responses', 'ffrA', 'ffrB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA feedback sends SELECT',    'sA', 'sel', 'event_feedback_sends', 'ffsA', 'ffsB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA forms SELECT (inactive)',  'sA', 'sel', 'forms', 'fmA', 'fmB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA forms UPDATE',             'sA', 'upd', 'forms', 'fmA', 'fmB', 'rows=1', 'rows=0', 'name');
SELECT pg_temp.ab('sA submissions SELECT',       'sA', 'sel', 'form_submissions', 'fsA', 'fsB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA email (event) SELECT',     'sA', 'sel', 'email_messages', 'emA', 'emB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('sA email (order) SELECT',     'sA', 'sel', 'email_messages', 'emoA', 'emoB', 'rows=1', 'rows=0');
SELECT pg_temp.expect('sA email (no event) SELECT', pg_temp.sel('sA', 'email_messages', 'emNone'), 'rows=0');

-- INSERTs on A pass, on B fail WITH CHECK (42501).
CREATE FUNCTION pg_temp.ins(who text, what text, s text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE e uuid := pg_temp.id('ev' || s);
BEGIN
  RETURN pg_temp.try(who, CASE what
    WHEN 'registration' THEN format('INSERT INTO public.event_registrations (contact_id, event_id) VALUES (%L, %L)', pg_temp.id('c2'), e)
    WHEN 'order' THEN format('INSERT INTO public.orders (event_id, buyer_first_name, buyer_last_name, buyer_email) VALUES (%L, ''x'', ''y'', ''z@t314.test'')', e)
    WHEN 'refund' THEN format('INSERT INTO public.order_refunds (order_id, amount_cents) VALUES (%L, 5)', pg_temp.id('o' || s))
    WHEN 'ticket' THEN format('INSERT INTO public.tickets (order_id, event_id, ticket_type_id, code) VALUES (%L, %L, %L, %L)', pg_temp.id('o' || s), e, pg_temp.id('tt' || s), 'N' || gen_random_uuid())
    WHEN 'ticket_type' THEN format('INSERT INTO public.ticket_types (event_id, name) VALUES (%L, ''New'')', e)
    WHEN 'promo' THEN format('INSERT INTO public.promo_codes (event_id, code, kind, percent_off) VALUES (%L, %L, ''percent'', 5)', e, 'N' || left(gen_random_uuid()::text, 8))
    WHEN 'outcome_response' THEN format('INSERT INTO public.event_outcome_responses (outcome_id, contact_id) VALUES (%L, %L)', pg_temp.id('ou' || s), pg_temp.id('c2'))
    WHEN 'feedback_send' THEN format('INSERT INTO public.event_feedback_sends (form_id, to_email) VALUES (%L, ''n@t314.test'')', pg_temp.id('ff' || s))
    WHEN 'submission' THEN format('INSERT INTO public.form_submissions (form_id, raw_data, dedup_action) VALUES (%L, ''{}'', ''new'')', pg_temp.id('fm' || s))
    WHEN 'label' THEN format('INSERT INTO public.event_labels (event_id, label_id) SELECT %L, id FROM public.labels WHERE name = ''t314 label2''', e)
  END);
END $$;
INSERT INTO public.labels (name, slug) VALUES ('t314 label2', 't314-label2-' || left(gen_random_uuid()::text, 6));
SELECT pg_temp.expect('sA INSERT ' || w || ' ' || s, pg_temp.ins('sA', w, s), CASE s WHEN 'A' THEN 'rows=1' ELSE 'err 42501' END)
FROM unnest(ARRAY['registration','order','refund','ticket','ticket_type','promo','outcome_response','feedback_send','submission','label']) w,
     unnest(ARRAY['A','B']) s;

-- Moving an A row to B is refused by WITH CHECK.
SELECT pg_temp.expect('sA move order A->B', pg_temp.try('sA', format('UPDATE public.orders SET event_id = %L WHERE id = %L', pg_temp.id('evB'), pg_temp.id('oA'))), 'err 42501');
SELECT pg_temp.expect('sA move promo A->B', pg_temp.try('sA', format('UPDATE public.promo_codes SET event_id = %L WHERE id = %L', pg_temp.id('evB'), pg_temp.id('pcA'))), 'err 42501');

-- ── 2. unfiltered writes (no WHERE): only A rows change ──
CREATE FUNCTION pg_temp.left_ab(tbl text, joinsql text) RETURNS text LANGUAGE sql AS $$
  SELECT format($q$SELECT 'A=' || count(*) FILTER (WHERE ev = %L) || ',B=' || count(*) FILTER (WHERE ev = %L) FROM (%s) z$q$,
                pg_temp.id('evA'), pg_temp.id('evB'), joinsql);
$$;
SELECT pg_temp.expect('unfiltered DELETE orders sA',
  pg_temp.unf('sA', 'DELETE FROM public.orders', pg_temp.left_ab('orders', 'SELECT event_id ev FROM public.orders')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE tickets sA',
  pg_temp.unf('sA', 'DELETE FROM public.tickets', pg_temp.left_ab('tickets', 'SELECT event_id ev FROM public.tickets')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE promo sA',
  pg_temp.unf('sA', 'DELETE FROM public.promo_codes', pg_temp.left_ab('promo_codes', 'SELECT event_id ev FROM public.promo_codes')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE refunds sA',
  pg_temp.unf('sA', 'DELETE FROM public.order_refunds', pg_temp.left_ab('order_refunds', 'SELECT o.event_id ev FROM public.order_refunds r JOIN public.orders o ON o.id = r.order_id')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE event_labels sA',
  pg_temp.unf('sA', 'DELETE FROM public.event_labels', pg_temp.left_ab('event_labels', 'SELECT event_id ev FROM public.event_labels')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE feedback resp sA',
  pg_temp.unf('sA', 'DELETE FROM public.event_feedback_responses', pg_temp.left_ab('x', 'SELECT f.event_id ev FROM public.event_feedback_responses r JOIN public.event_feedback_forms f ON f.id = r.form_id')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE outcome resp sA',
  pg_temp.unf('sA', 'DELETE FROM public.event_outcome_responses', pg_temp.left_ab('x', 'SELECT o.event_id ev FROM public.event_outcome_responses r JOIN public.event_outcomes o ON o.id = r.outcome_id')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE workflows sA',
  pg_temp.unf('sA', 'DELETE FROM public.outcome_workflows', pg_temp.left_ab('x', 'SELECT o.event_id ev FROM public.outcome_workflows r JOIN public.event_outcomes o ON o.id = r.outcome_id')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered DELETE ticket_types sA (tickets first)',
  pg_temp.unf('sA', 'DELETE FROM public.tickets; DELETE FROM public.ticket_types', pg_temp.left_ab('x', 'SELECT event_id ev FROM public.ticket_types')), 'A=0,B=1');
SELECT pg_temp.expect('unfiltered UPDATE tickets sA',
  pg_temp.unf('sA', 'UPDATE public.tickets SET status = ''void''', pg_temp.left_ab('x', 'SELECT event_id ev FROM public.tickets WHERE status = ''void''')), 'A=1,B=0');
SELECT pg_temp.expect('unfiltered UPDATE events sA',
  pg_temp.unf('sA', 'UPDATE public.events SET title = ''hit''', pg_temp.left_ab('x', 'SELECT id ev FROM public.events WHERE title = ''hit''')), 'A=1,B=0');
SELECT pg_temp.expect('unfiltered DELETE orders gH (control)',
  pg_temp.unf('gH', 'DELETE FROM public.orders', pg_temp.left_ab('orders', 'SELECT event_id ev FROM public.orders')), 'A=0,B=0');

-- ── 3. cA: create-scoped only (most prod scoped users) ──
-- cA holds events.create only (no events.view), so the UPDATE's row lookup
-- cannot see A's draft event: 0 rows, exactly as before 314. On prod every
-- create-scoped user also holds an unscoped events.view, so they see and edit A.
SELECT pg_temp.ab('cA events UPDATE',        'cA', 'upd', 'events', 'evA', 'evB', 'rows=0', 'rows=0', 'title');
SELECT pg_temp.expect('cA events UPDATE A, unfiltered (policy itself allows A only)',
  pg_temp.unf('cA', 'UPDATE public.events SET title = ''hit''', pg_temp.left_ab('x', 'SELECT id ev FROM public.events WHERE title = ''hit''')), 'A=1,B=0');
SELECT pg_temp.ab('cA ticket_types UPDATE',  'cA', 'upd', 'ticket_types', 'ttA', 'ttB', 'rows=1', 'rows=0', 'name');
SELECT pg_temp.ab('cA promo DELETE',         'cA', 'del', 'promo_codes', 'pcA', 'pcB', 'rows=1', 'rows=0');
SELECT pg_temp.ab('cA forms UPDATE',         'cA', 'upd', 'forms', 'fmA', 'fmB', 'rows=1', 'rows=0', 'name');
SELECT pg_temp.ab('cA orders SELECT',        'cA', 'sel', 'orders', 'oA', 'oB', 'rows=0', 'rows=0');
SELECT pg_temp.ab('cA tickets UPDATE',       'cA', 'upd', 'tickets', 'tA', 'tB', 'rows=0', 'rows=0', 'status');
-- Event creation: no event id to scope against. A scoped creator may still
-- create, but only as themselves; they then manage it through the creator arm.
CREATE FUNCTION pg_temp.new_event(who text, owner_k text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(who, format('INSERT INTO public.events (title, start_date, created_by) VALUES (''new'', current_date, %L)', pg_temp.uid(owner_k)));
$$;
SELECT pg_temp.expect('cA INSERT event as self',      pg_temp.new_event('cA', 'cA'),  'rows=1');
SELECT pg_temp.expect('cA INSERT event as adm',       pg_temp.new_event('cA', 'adm'), 'err 42501');
SELECT pg_temp.expect('gH INSERT event as adm',       pg_temp.new_event('gH', 'adm'), 'rows=1');
SELECT pg_temp.expect('rA INSERT event as self',      pg_temp.new_event('rA', 'rA'),  'err 42501');
SELECT pg_temp.expect('nobody INSERT event as self',  pg_temp.new_event('nobody', 'nobody'), 'err 42501');
SELECT pg_temp.expect('off INSERT event as self',     pg_temp.new_event('off', 'off'), 'err 42501');
SELECT pg_temp.expect('cA creator arm: manage own new event children',
  pg_temp.unf('cA',
    'INSERT INTO public.events (title, start_date, created_by) VALUES (''own'', current_date, auth.uid());
     INSERT INTO public.ticket_types (event_id, name) SELECT id, ''Own GA'' FROM public.events WHERE title = ''own''',
    'SELECT count(*)::text FROM public.ticket_types WHERE name = ''Own GA'''), '1');
SELECT pg_temp.expect('cA creator arm: no orders (no registrations key anywhere)',
  pg_temp.unf('cA',
    'INSERT INTO public.events (title, start_date, created_by) VALUES (''own'', current_date, auth.uid());
     INSERT INTO public.orders (event_id, buyer_first_name, buyer_last_name, buyer_email) SELECT id, ''a'', ''b'', ''c@t314.test'' FROM public.events WHERE title = ''own''',
    'SELECT ''inserted'''), 'err 42501');

-- ── 4. rA: scoped via a role (user_roles.scope_type = event) ──
SELECT pg_temp.ab('rA tickets UPDATE',        'rA', 'upd', 'tickets', 'tA', 'tB', 'rows=1', 'rows=0', 'status');
-- Registrations have separate INSERT/UPDATE policies (not ALL), so a row lookup
-- needs events.view, which rA lacks: 0 rows by id, as before 314. The INSERT
-- policy itself is scoped, and an unfiltered UPDATE reaches no rows.
SELECT pg_temp.ab('rA registrations UPDATE',  'rA', 'upd', 'event_registrations', 'regA', 'regB', 'rows=0', 'rows=0', 'status');
SELECT pg_temp.expect('rA INSERT registration A', pg_temp.ins('rA', 'registration', 'A'), 'rows=1');
SELECT pg_temp.expect('rA INSERT registration B', pg_temp.ins('rA', 'registration', 'B'), 'err 42501');
SELECT pg_temp.ab('rA scan links UPDATE',     'rA', 'upd', 'event_scan_links', 'slA', 'slB', 'rows=1', 'rows=0', 'token');
SELECT pg_temp.ab('rA promo DELETE',          'rA', 'del', 'promo_codes', 'pcA', 'pcB', 'rows=0', 'rows=0');

-- ── 5. unscoped holder, finance, admin, deactivated, nobody ──
SELECT pg_temp.ab('gH events UPDATE',         'gH', 'upd', 'events', 'evA', 'evB', 'rows=1', 'rows=1', 'title');
SELECT pg_temp.ab('gH orders DELETE',         'gH', 'del', 'orders', 'oA', 'oB', 'rows=1', 'rows=1');
SELECT pg_temp.ab('gH refunds SELECT',        'gH', 'sel', 'order_refunds', 'rfA', 'rfB', 'rows=1', 'rows=1');
SELECT pg_temp.ab('gH feedback resp DELETE',  'gH', 'del', 'event_feedback_responses', 'ffrA', 'ffrB', 'rows=1', 'rows=1');
SELECT pg_temp.ab('gH submissions SELECT',    'gH', 'sel', 'form_submissions', 'fsA', 'fsB', 'rows=1', 'rows=1');
SELECT pg_temp.ab('gH scan links UPDATE',     'gH', 'upd', 'event_scan_links', 'slA', 'slB', 'rows=1', 'rows=1', 'token');
SELECT pg_temp.expect('gH email (no event) SELECT', pg_temp.sel('gH', 'email_messages', 'emNone'), 'rows=1');
SELECT pg_temp.expect('gH INSERT order B', pg_temp.ins('gH', 'order', 'B'), 'rows=1');
SELECT pg_temp.ab('fin orders UPDATE',        'fin', 'upd', 'orders', 'oA', 'oB', 'rows=1', 'rows=1', 'status');
SELECT pg_temp.ab('fin refunds SELECT',       'fin', 'sel', 'order_refunds', 'rfA', 'rfB', 'rows=1', 'rows=1');
SELECT pg_temp.ab('fin tickets UPDATE',       'fin', 'upd', 'tickets', 'tA', 'tB', 'rows=0', 'rows=0', 'status');
SELECT pg_temp.expect('fin email (no event) SELECT', pg_temp.sel('fin', 'email_messages', 'emNone'), 'rows=1');
SELECT pg_temp.ab('adm events UPDATE',        'adm', 'upd', 'events', 'evA', 'evB', 'rows=1', 'rows=1', 'title');
SELECT pg_temp.ab('adm tickets DELETE',       'adm', 'del', 'tickets', 'tA', 'tB', 'rows=1', 'rows=1');
SELECT pg_temp.ab('adm scan links UPDATE',    'adm', 'upd', 'event_scan_links', 'slA', 'slB', 'rows=1', 'rows=1', 'token');
SELECT pg_temp.ab('adm workflows UPDATE',     'adm', 'upd', 'outcome_workflows', 'wfA', 'wfB', 'rows=1', 'rows=1', 'name');
SELECT pg_temp.expect('adm email (no event) SELECT', pg_temp.sel('adm', 'email_messages', 'emNone'), 'rows=1');
SELECT pg_temp.ab('off orders SELECT',        'off', 'sel', 'orders', 'oA', 'oB', 'rows=0', 'rows=0');
SELECT pg_temp.ab('off events UPDATE',        'off', 'upd', 'events', 'evA', 'evB', 'rows=0', 'rows=0', 'title');
SELECT pg_temp.expect('off INSERT order A', pg_temp.ins('off', 'order', 'A'), 'err 42501');
SELECT pg_temp.expect('off unfiltered DELETE orders',
  pg_temp.unf('off', 'DELETE FROM public.orders', pg_temp.left_ab('orders', 'SELECT event_id ev FROM public.orders')), 'A=1,B=1');
SELECT pg_temp.ab('nobody orders SELECT',     'nobody', 'sel', 'orders', 'oA', 'oB', 'rows=0', 'rows=0');
SELECT pg_temp.ab('nobody tickets DELETE',    'nobody', 'del', 'tickets', 'tA', 'tB', 'rows=0', 'rows=0');

-- ── 6. public reads ──
SELECT pg_temp.expect('anon open feedback form B',      pg_temp.sel('anon', 'event_feedback_forms', 'ffOpenB'), 'rows=1');
SELECT pg_temp.expect('anon draft feedback form A',     pg_temp.sel('anon', 'event_feedback_forms', 'ffA'), 'rows=0');
SELECT pg_temp.expect('anon active form B',             pg_temp.sel('anon', 'forms', 'fmActB'), 'rows=1');
SELECT pg_temp.expect('anon inactive form A',           pg_temp.sel('anon', 'forms', 'fmA'), 'rows=0');
SELECT pg_temp.expect('anon orders A',                  pg_temp.sel('anon', 'orders', 'oA'), 'rows=0');
SELECT pg_temp.expect('anon refunds A (helper EXECUTE)', pg_temp.sel('anon', 'order_refunds', 'rfA'), 'rows=0');
SELECT pg_temp.expect('anon email (order) A',           pg_temp.sel('anon', 'email_messages', 'emoA'), 'rows=0');
SELECT pg_temp.expect('anon feedback resp A',           pg_temp.sel('anon', 'event_feedback_responses', 'ffrA'), 'rows=0');
SELECT pg_temp.expect('anon INSERT order A',            pg_temp.ins('anon', 'order', 'A'), 'err 42501');
SELECT pg_temp.expect('anon unfiltered DELETE tickets',
  pg_temp.unf('anon', 'DELETE FROM public.tickets', pg_temp.left_ab('x', 'SELECT event_id ev FROM public.tickets')), 'A=1,B=1');
SELECT pg_temp.expect('sA open feedback form B (public)', pg_temp.sel('sA', 'event_feedback_forms', 'ffOpenB'), 'rows=1');
SELECT pg_temp.expect('sA active form B (public)',        pg_temp.sel('sA', 'forms', 'fmActB'), 'rows=1');

-- ── 7. finance_org_choices (unchanged: any active events.create holder, any scope) ──
SELECT pg_temp.expect('finance_org_choices cA',     pg_temp.fn('cA', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '1');
SELECT pg_temp.expect('finance_org_choices sA',     pg_temp.fn('sA', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '1');
SELECT pg_temp.expect('finance_org_choices gH',     pg_temp.fn('gH', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '1');
SELECT pg_temp.expect('finance_org_choices rA',     pg_temp.fn('rA', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '0');
SELECT pg_temp.expect('finance_org_choices off',    pg_temp.fn('off', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '0');
SELECT pg_temp.expect('finance_org_choices nobody', pg_temp.fn('nobody', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '0');
SELECT pg_temp.expect('finance_org_choices anon',   pg_temp.fn('anon', '(SELECT count(*) FROM public.finance_org_choices() WHERE key = ''npc'')'), '0');

-- ── 8. helpers directly ──
SELECT pg_temp.expect('has_event_permission(view,A) sA',  pg_temp.fn('sA', format('public.has_event_permission(''events.view'', %L)', pg_temp.id('evA'))), 'true');
SELECT pg_temp.expect('has_event_permission(view,B) sA',  pg_temp.fn('sA', format('public.has_event_permission(''events.view'', %L)', pg_temp.id('evB'))), 'false');
SELECT pg_temp.expect('has_event_permission(view,NULL) sA', pg_temp.fn('sA', 'public.has_event_permission(''events.view'', NULL)'), 'false');
SELECT pg_temp.expect('has_event_permission(view,NULL) gH', pg_temp.fn('gH', 'public.has_event_permission(''events.view'', NULL)'), 'true');
SELECT pg_temp.expect('has_event_permission(view,B) gH',  pg_temp.fn('gH', format('public.has_event_permission(''events.view'', %L)', pg_temp.id('evB'))), 'true');
SELECT pg_temp.expect('has_event_permission(attendance,A) rA', pg_temp.fn('rA', format('public.has_event_permission(''events.manage_attendance'', %L)', pg_temp.id('evA'))), 'true');
SELECT pg_temp.expect('has_event_permission(attendance,B) rA', pg_temp.fn('rA', format('public.has_event_permission(''events.manage_attendance'', %L)', pg_temp.id('evB'))), 'false');
SELECT pg_temp.expect('has_event_permission(view,A) off', pg_temp.fn('off', format('public.has_event_permission(''events.view'', %L)', pg_temp.id('evA'))), 'false');
SELECT pg_temp.expect('has_event_permission(view,A) anon', pg_temp.fn('anon', format('public.has_event_permission(''events.view'', %L)', pg_temp.id('evA'))), 'false');
SELECT pg_temp.expect('has_event_permission(create,A) cA', pg_temp.fn('cA', format('public.has_event_permission(''events.create'', %L)', pg_temp.id('evA'))), 'true');
SELECT pg_temp.expect('has_event_permission(view,A) cA',  pg_temp.fn('cA', format('public.has_event_permission(''events.view'', %L)', pg_temp.id('evA'))), 'false');
SELECT pg_temp.expect('event_id_of_order(oB) sA',         pg_temp.fn('sA', format('public.event_id_of_order(%L)', pg_temp.id('oB'))), pg_temp.id('evB')::text);
SELECT pg_temp.expect('event_id_of_order(oA) anon',       pg_temp.fn('anon', format('public.event_id_of_order(%L)', pg_temp.id('oA'))), 'null');
SELECT pg_temp.expect('event_id_of_feedback_form(ffA)',   pg_temp.fn('sA', format('public.event_id_of_feedback_form(%L)', pg_temp.id('ffA'))), pg_temp.id('evA')::text);
SELECT pg_temp.expect('event_id_of_outcome(ouA)',         pg_temp.fn('sA', format('public.event_id_of_outcome(%L)', pg_temp.id('ouA'))), pg_temp.id('evA')::text);
SELECT pg_temp.expect('event_id_of_form(fmB)',            pg_temp.fn('sA', format('public.event_id_of_form(%L)', pg_temp.id('fmB'))), pg_temp.id('evB')::text);
SELECT pg_temp.expect('permitted_event_ids(view) sA = {A}',
  pg_temp.fn('sA', format('(SELECT array_agg(x) FROM public.permitted_event_ids(''events.view'') x WHERE x IN (%L, %L))', pg_temp.id('evA'), pg_temp.id('evB'))), '{' || pg_temp.id('evA') || '}');
SELECT pg_temp.expect('permitted_event_ids(view) anon empty',
  pg_temp.fn('anon', '(SELECT count(*) FROM public.permitted_event_ids(''events.view''))'), '0');
SELECT pg_temp.expect('permitted_event_ids(view) off empty',
  pg_temp.fn('off', '(SELECT count(*) FROM public.permitted_event_ids(''events.view''))'), '0');
SELECT pg_temp.expect('event_id_of_order(unknown)',       pg_temp.fn('sA', format('public.event_id_of_order(%L)', gen_random_uuid())), 'null');
SELECT pg_temp.expect('helpers: definer, stable, search_path empty',
  (SELECT string_agg(DISTINCT (p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'])::text, ',')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('has_event_permission','permitted_event_ids','event_id_of_order','event_id_of_feedback_form','event_id_of_outcome','event_id_of_form')),
  'true');
SELECT pg_temp.expect('helpers: anon + authenticated EXECUTE',
  (SELECT string_agg(DISTINCT (has_function_privilege('anon', p.oid, 'EXECUTE') AND has_function_privilege('authenticated', p.oid, 'EXECUTE'))::text, ',')
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN ('has_event_permission','permitted_event_ids','event_id_of_order','event_id_of_feedback_form','event_id_of_outcome','event_id_of_form')),
  'true');
SELECT pg_temp.expect('no events policy still calls has_permission(events.*) except creator INSERT arm + fee profiles',
  (SELECT string_agg(tablename || '/' || policyname, '; ' ORDER BY tablename)
     FROM pg_policies WHERE schemaname = 'public'
      AND coalesce(qual, '') || coalesce(with_check, '') ~ 'has_permission\(''events'),
  'events/Admins and events admins can create events; payment_fee_profiles/Admins, finance, events can read fee profiles');

-- ── report ──
DO $$
DECLARE r record; bad int := 0; total int := 0;
BEGIN
  FOR r IN SELECT * FROM t314 ORDER BY n LOOP
    total := total + 1;
    IF r.got IS DISTINCT FROM r.want THEN
      bad := bad + 1;
      RAISE NOTICE 'FAIL  %: got %, want %', r.label, r.got, r.want;
    END IF;
  END LOOP;
  RAISE NOTICE '314 test: % checks, % pass', total, total - bad;
  IF bad > 0 THEN RAISE EXCEPTION '314 test: % failure(s)', bad; END IF;
END $$;
ROLLBACK;
