-- users_self_update_lockdown_test.sql: disposable check for migration 315.
-- Not a migration. Run it against a throwaway database with the real schema
-- (304-309, 307, then 315). One transaction, rolled back. Never point this at
-- a shared or remote database.
--
--   psql -v ON_ERROR_STOP=1 -d <throwaway> -f supabase/tests/users_self_update_lockdown.sql
--
-- People:
--   me     active staff (staff role, signup_type staff)
--   stu    active student (student role, signup_type NULL)
--   off    deactivated staff
--   other  active staff whose household and contact `me` would like to take
--   adm    admin
--   sa     super_admin
--   spouse active user with a pending household link (definer flow)
--   anon   not signed in
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
BEGIN;

CREATE TEMP TABLE t315 (n serial, label text, got text, want text);
GRANT ALL ON t315 TO PUBLIC;
GRANT USAGE ON SEQUENCE t315_n_seq TO PUBLIC;

DO $$
DECLARE
  ids jsonb := '{}'::jsonb;
  who text;
  hh_other uuid; c_other uuid;
BEGIN
  INSERT INTO public.roles (name, display_name) VALUES
    ('staff','Staff'), ('student','Student'), ('admin','Admin'),
    ('super_admin','Super Admin'), ('leadership_team','Leadership Team'),
    ('self_service','Self service')
  ON CONFLICT (name) DO NOTHING;
  INSERT INTO public.staff_ministries (name, slug, ministry_type) VALUES
    ('Media T315','media_t315','main'),
    ('Leadership Team','leadership_team','main'),
    ('Hope Again T315','hope_t315','part_time'),
    ('No Ministry','no_ministry','main')
  ON CONFLICT (slug) DO NOTHING;

  FOREACH who IN ARRAY ARRAY['me','stu','off','other','adm','sa','spouse','tgt'] LOOP
    ids := ids || jsonb_build_object(who, gen_random_uuid());
    INSERT INTO auth.users (id, email) VALUES ((ids->>who)::uuid, who || '@t315.test');
    INSERT INTO public.users (id, email, first_name, last_name, is_active, signup_type, status, accepted_at)
    VALUES ((ids->>who)::uuid, who || '@t315.test', who, 'T315', who <> 'off',
            CASE WHEN who IN ('me','off','other','spouse','tgt') THEN 'staff' END,
            CASE WHEN who = 'tgt' THEN 'invited' ELSE 'active' END,
            CASE WHEN who = 'tgt' THEN NULL ELSE now() - interval '30 days' END);
  END LOOP;

  INSERT INTO public.user_roles (user_id, role_id)
  SELECT (ids->>p.who)::uuid, r.id
  FROM (VALUES ('me','staff'),('off','staff'),('other','staff'),('spouse','staff'),('tgt','staff'),
               ('stu','student'),('adm','admin'),('sa','super_admin')) AS p(who, role)
  JOIN public.roles r ON r.name = p.role;

  -- The other user's household (with a child) and CRM contact.
  INSERT INTO public.households (created_by) VALUES ((ids->>'other')::uuid) RETURNING id INTO hh_other;
  UPDATE public.users SET household_id = hh_other WHERE id = (ids->>'other')::uuid;
  INSERT INTO public.household_members (household_id, user_id, relationship, full_name)
  VALUES (hh_other, (ids->>'other')::uuid, 'child', 'Child of Other');
  INSERT INTO public.contacts (first_name, last_name, email) VALUES ('Other','T315','other@t315.test')
  RETURNING id INTO c_other;

  PERFORM set_config('t315.ids', ids::text, false);
  PERFORM set_config('t315.hh_other', hh_other::text, false);
  PERFORM set_config('t315.c_other', c_other::text, false);
END $$;

-- Run one statement as a person; report rows affected or SQLSTATE. Rolled back.
CREATE FUNCTION pg_temp.try(who text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int; res text;
BEGIN
  BEGIN
    IF who = 'anon' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
      EXECUTE 'SET LOCAL ROLE anon';
    ELSIF who = 'service' THEN
      PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
      EXECUTE 'SET LOCAL ROLE service_role';
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', current_setting('t315.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
      EXECUTE 'SET LOCAL ROLE authenticated';
    END IF;
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
    RAISE EXCEPTION USING ERRCODE = 'P0315', MESSAGE = 'rows=' || n;
  EXCEPTION WHEN SQLSTATE 'P0315' THEN res := SQLERRM;
            WHEN OTHERS THEN res := 'err ' || SQLSTATE;
  END;
  RETURN res;
END $$;

-- Run statements as a person and keep the result (for definer-flow checks).
CREATE FUNCTION pg_temp.keep(who text, stmt text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', current_setting('t315.ids')::jsonb->>who, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE stmt INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN v;
END $$;

CREATE FUNCTION pg_temp.id(who text) RETURNS uuid LANGUAGE sql AS $$
  SELECT (current_setting('t315.ids')::jsonb->>who)::uuid $$;

CREATE FUNCTION pg_temp.upd(who text, target text, setx text) RETURNS text LANGUAGE sql AS $$
  SELECT pg_temp.try(who, format('UPDATE public.users SET %s WHERE id = %L', setx, pg_temp.id(target))) $$;

CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE sql AS $$
  INSERT INTO t315 (label, got, want) VALUES (label, got, want) $$;

-- A value that differs from the current one, by type.
CREATE FUNCTION pg_temp.newval(col text, typ text) RETURNS text LANGUAGE sql AS $$
  SELECT CASE
    WHEN col = 'status' THEN quote_literal('pending_approval')
    WHEN col = 'signup_type' THEN quote_literal('community')
    WHEN col = 'base_driving_test_status' THEN quote_literal('passed')
    WHEN col = 'slack_link_source' THEN quote_literal('self')
    WHEN col = 'licence_kind' THEN quote_literal('sa')
    WHEN col = 'contact_id' THEN quote_literal(current_setting('t315.c_other'))
    WHEN col IN ('household_id','pending_household_id') THEN quote_literal(current_setting('t315.hh_other'))
    WHEN col IN ('merged_into_user_id','licence_uploaded_by') THEN quote_literal(pg_temp.id('other'))
    WHEN col = 'id' THEN quote_literal(gen_random_uuid())
    WHEN col = 'health_insurance_no_expiry' THEN 'true'
    WHEN col = 'next_health_insurance_no_expiry' THEN 'true'
    WHEN typ = 'boolean' THEN format('NOT coalesce(%I, false)', col)
    WHEN typ = 'uuid' THEN quote_literal(gen_random_uuid())
    WHEN typ = 'date' THEN quote_literal('2031-01-31')
    WHEN typ LIKE 'timestamp%' THEN quote_literal('2031-01-31T10:00:00Z')
    ELSE quote_literal('t315 ' || col)
  END $$;

DO $$
DECLARE
  self_cols constant text[] := ARRAY[
    'first_name','last_name','preferred_name','date_of_birth','gender',
    'marital_status','nationality','phone',
    'address_line_1','address_line_2','city','province','country','postal_code',
    'emergency_contact_name','emergency_contact_phone','emergency_contact_relationship',
    'health_insurance_provider','health_insurance_policy_number',
    'health_insurance_expiry_date','health_insurance_no_expiry','health_insurance_confirmed_at',
    'next_health_insurance_provider','next_health_insurance_policy_number',
    'next_health_insurance_expiry_date','next_health_insurance_no_expiry',
    'passport_country','passport_number','passport_expiry_date',
    'visa_category','visa_type','visa_expiry_date','is_international',
    'essence_statement','has_children'];
  c record;
  n_priv int := 0;
  setx text;
BEGIN
  ---------------------------------------------------------------- 1. self-edit allowlist
  FOR c IN SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users' AND column_name = ANY (self_cols)
           ORDER BY ordinal_position LOOP
    setx := format('%I = %s', c.column_name, pg_temp.newval(c.column_name, c.data_type));
    IF c.column_name = 'health_insurance_no_expiry' THEN setx := setx || ', health_insurance_expiry_date = NULL'; END IF;
    IF c.column_name = 'next_health_insurance_no_expiry' THEN setx := setx || ', next_health_insurance_expiry_date = NULL'; END IF;
    PERFORM pg_temp.expect('self edits ' || c.column_name, pg_temp.upd('me','me', setx), 'rows=1');
  END LOOP;
  PERFORM pg_temp.expect('self sets department to a main ministry',
    pg_temp.upd('me','me', $s$department = 'media_t315'$s$), 'rows=1');
  PERFORM pg_temp.expect('self clears department',
    pg_temp.upd('me','me', 'department = NULL'), 'rows=1');
  PERFORM pg_temp.expect('self sets department to no_ministry',
    pg_temp.upd('me','me', $s$department = 'no_ministry'$s$), 'rows=1');
  PERFORM pg_temp.expect('onboarding finish (accepted_at from NULL, status active)',
    pg_temp.upd('tgt','tgt', $s$accepted_at = now(), status = 'active'$s$), 'rows=1');
  PERFORM pg_temp.expect('profile save resends unchanged department',
    pg_temp.try('me', format($s$UPDATE public.users SET department = department, phone = '0820000000' WHERE id = %L$s$, pg_temp.id('me'))), 'rows=1');
  PERFORM pg_temp.expect('the /api/profile/update shape (many fields at once)',
    pg_temp.upd('me','me', $s$first_name='Me', last_name='T315', date_of_birth='1990-01-01', gender='male',
      marital_status='single', nationality='ZA', phone='0821111111', address_line_1='1 St', city='CT',
      province='WC', country='ZA', postal_code='8001', emergency_contact_name='E', emergency_contact_phone='1',
      emergency_contact_relationship='friend', health_insurance_provider='Discovery',
      health_insurance_policy_number='P1', health_insurance_expiry_date='2031-01-01',
      passport_country='ZA', passport_number='A1', passport_expiry_date='2031-01-01',
      visa_category=NULL, visa_type=NULL, visa_expiry_date=NULL$s$), 'rows=1');

  ---------------------------------------------------------------- 2. every other column is refused for self
  FOR c IN SELECT column_name, data_type FROM information_schema.columns
           WHERE table_schema='public' AND table_name='users'
             AND column_name <> ALL (self_cols || ARRAY['department','status','accepted_at','updated_at'])
           ORDER BY ordinal_position LOOP
    n_priv := n_priv + 1;
    PERFORM pg_temp.expect('self refused: ' || c.column_name,
      pg_temp.upd('me','me', format('%I = %s', c.column_name, pg_temp.newval(c.column_name, c.data_type))), 'err 42501');
  END LOOP;
  PERFORM pg_temp.expect('privileged columns checked', n_priv::text, '41');

  -- Named exploit paths, as the people who would try them.
  PERFORM pg_temp.expect('deactivated user reactivates self',
    pg_temp.upd('off','off','is_active = true'), 'err 42501');
  PERFORM pg_temp.expect('deactivated user edits phone',
    pg_temp.upd('off','off', $s$phone = '0830000000'$s$), 'err 42501');
  PERFORM pg_temp.expect('self links to another contact',
    pg_temp.upd('me','me', format('contact_id = %L', current_setting('t315.c_other'))), 'err 42501');
  PERFORM pg_temp.expect('self joins another household',
    pg_temp.upd('me','me', format('household_id = %L', current_setting('t315.hh_other'))), 'err 42501');
  PERFORM pg_temp.expect('self points pending link at another household',
    pg_temp.upd('me','me', format('pending_household_id = %L', current_setting('t315.hh_other'))), 'err 42501');
  PERFORM pg_temp.expect('self sets department leadership_team',
    pg_temp.upd('me','me', $s$department = 'leadership_team'$s$), 'err 42501');
  PERFORM pg_temp.expect('self sets a part-time department',
    pg_temp.upd('me','me', $s$department = 'hope_t315'$s$), 'err 42501');
  PERFORM pg_temp.expect('self sets an unknown department',
    pg_temp.upd('me','me', $s$department = 'nope_t315'$s$), 'err 42501');
  PERFORM pg_temp.expect('student sets a department',
    pg_temp.upd('stu','stu', $s$department = 'media_t315'$s$), 'err 42501');
  PERFORM pg_temp.expect('student becomes staff via signup_type',
    pg_temp.upd('stu','stu', $s$signup_type = 'staff'$s$), 'err 42501');
  PERFORM pg_temp.expect('self passes the driving test',
    pg_temp.upd('me','me', $s$base_driving_test_status = 'passed'$s$), 'err 42501');
  PERFORM pg_temp.expect('self sets job_title',
    pg_temp.upd('me','me', $s$job_title = 'Director'$s$), 'err 42501');
  PERFORM pg_temp.expect('self sets job_description',
    pg_temp.upd('me','me', $s$job_description = 'x'$s$), 'err 42501');
  PERFORM pg_temp.expect('self changes email',
    pg_temp.upd('me','me', $s$email = 'other@t315.test'$s$), 'err 42501');
  PERFORM pg_temp.expect('self points licence file at another path',
    pg_temp.upd('me','me', $s$licence_file_url = 'user-licenses/x/1.jpg'$s$), 'err 42501');
  PERFORM pg_temp.expect('self sets status pending_approval',
    pg_temp.upd('me','me', $s$status = 'pending_approval'$s$), 'err 42501');
  PERFORM pg_temp.expect('self rewrites accepted_at',
    pg_temp.upd('me','me', $s$accepted_at = '2020-01-01'$s$), 'err 42501');
  PERFORM pg_temp.expect('self sets status invited',
    pg_temp.upd('me','me', $s$status = 'invited'$s$), 'err 42501');
  PERFORM pg_temp.expect('self edits another user (RLS: 0 rows)',
    pg_temp.upd('me','other', $s$phone = '1'$s$), 'rows=0');
  PERFORM pg_temp.expect('self deletes own row',
    pg_temp.try('me', format('DELETE FROM public.users WHERE id = %L', pg_temp.id('me'))), 'err 42501');
  PERFORM pg_temp.expect('authenticated truncates users',
    pg_temp.try('me', 'TRUNCATE public.users CASCADE'), 'err 42501');
  PERFORM pg_temp.expect('non-admin inserts a user (no INSERT grant)',
    pg_temp.try('me', format($s$INSERT INTO public.users (id, email) VALUES (%L, 'x@t315.test')$s$, gen_random_uuid())), 'err 42501');
  PERFORM pg_temp.expect('non-admin upserts own row (no INSERT grant)',
    pg_temp.try('me', format($s$INSERT INTO public.users (id, email) VALUES (%L, 'me@t315.test') ON CONFLICT (id) DO UPDATE SET phone = '1'$s$, pg_temp.id('me'))), 'err 42501');

  ---------------------------------------------------------------- 3. anon
  PERFORM pg_temp.expect('anon updates a user', pg_temp.upd('anon','me', $s$phone = '1'$s$), 'err 42501');
  PERFORM pg_temp.expect('anon inserts a user',
    pg_temp.try('anon', format($s$INSERT INTO public.users (id, email) VALUES (%L, 'a@t315.test')$s$, gen_random_uuid())), 'err 42501');
  PERFORM pg_temp.expect('anon deletes users', pg_temp.try('anon', 'DELETE FROM public.users'), 'err 42501');
  PERFORM pg_temp.expect('anon truncates users', pg_temp.try('anon', 'TRUNCATE public.users CASCADE'), 'err 42501');
  PERFORM pg_temp.expect('anon reads users (RLS: 0 rows)', pg_temp.try('anon', 'SELECT * FROM public.users'), 'rows=0');

  ---------------------------------------------------------------- 4. admin through the user client
  PERFORM pg_temp.expect('admin approves (job_title + status)',
    pg_temp.upd('adm','me', $s$job_title = 'Media Lead', status = 'active'$s$), 'rows=1');
  PERFORM pg_temp.expect('admin puts a user on hold',
    pg_temp.upd('adm','me', $s$status = 'pending_approval'$s$), 'rows=1');
  PERFORM pg_temp.expect('admin sets another user''s department',
    pg_temp.upd('adm','other', $s$department = 'media_t315'$s$), 'rows=1');
  PERFORM pg_temp.expect('admin edits another user''s profile fields',
    pg_temp.upd('adm','other', $s$phone = '0840000000', first_name = 'Othe'$s$), 'rows=1');
  PERFORM pg_temp.expect('admin inserts a user via user client (no INSERT grant)',
    pg_temp.try('adm', format($s$INSERT INTO public.users (id, email) VALUES (%L, 'new@t315.test')$s$, gen_random_uuid())), 'err 42501');
  PERFORM pg_temp.expect('super admin inserts a user via user client (no INSERT grant)',
    pg_temp.try('sa', format($s$INSERT INTO public.users (id, email) VALUES (%L, 'new2@t315.test')$s$, gen_random_uuid())), 'err 42501');
  PERFORM pg_temp.expect('admin sets is_active via user client (grant; app uses service role)',
    pg_temp.upd('adm','off','is_active = true'), 'err 42501');
  UPDATE public.users SET status = 'pending_approval' WHERE id = pg_temp.id('stu');
  PERFORM pg_temp.expect('self on hold cannot lift it',
    pg_temp.upd('stu','stu', $s$status = 'active'$s$), 'err 42501');
  UPDATE public.users SET status = 'active' WHERE id = pg_temp.id('stu');

  ---------------------------------------------------------------- 5. super-admin guard still bites
  PERFORM pg_temp.expect('admin changes a super admin''s job_title',
    pg_temp.upd('adm','sa', $s$job_title = 'x'$s$), 'err 42501');
  PERFORM pg_temp.expect('super admin changes a super admin''s job_title',
    pg_temp.upd('sa','sa', $s$job_title = 'Founder'$s$), 'rows=1');

  ---------------------------------------------------------------- 6. service role
  PERFORM pg_temp.expect('service role reactivates',
    pg_temp.upd('service','off','is_active = true'), 'rows=1');
  PERFORM pg_temp.expect('service role sets the driving test',
    pg_temp.upd('service','me', $s$base_driving_test_status = 'passed', base_driving_test_passed_at = now()$s$), 'rows=1');
  PERFORM pg_temp.expect('service role creates a user (signup / invite / accept-application shape)',
    pg_temp.try('service', format($s$INSERT INTO public.users (id, email, first_name, last_name, invited_at, signup_type, accepted_at)
      VALUES (%L, 'svc@t315.test', 'Svc', 'T315', now(), 'staff', now())$s$, gen_random_uuid())), 'rows=1');
  PERFORM pg_temp.expect('service role creates a user (accept-application shape)',
    pg_temp.try('service', format($s$INSERT INTO public.users (id, email, first_name, last_name, city, country, date_of_birth, gender, nationality, phone, invited_at, status, setup_invite_due_on)
      VALUES (%L, 'svc2@t315.test', 'Svc', 'T315', 'CT', 'ZA', '2000-01-01', 'female', 'ZA', '1', now(), 'invited', current_date)$s$, gen_random_uuid())), 'rows=1');
  PERFORM pg_temp.expect('service role sets contact_id',
    pg_temp.upd('service','me', format('contact_id = %L', current_setting('t315.c_other'))), 'rows=1');
END $$;

-- guard_super_admin_account on a column the user client can no longer write
-- (is_active): run as the table owner with an admin's claims.
DO $$
DECLARE r text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', pg_temp.id('adm'), 'role', 'authenticated')::text, true);
    UPDATE public.users SET is_active = false WHERE id = pg_temp.id('sa');
    RAISE EXCEPTION USING ERRCODE = 'P0315', MESSAGE = 'rows=1';
  EXCEPTION WHEN SQLSTATE 'P0315' THEN r := SQLERRM;
            WHEN OTHERS THEN r := 'err ' || SQLSTATE;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  PERFORM pg_temp.expect('super-admin guard: admin claims deactivating a super admin', r, 'err 42501');
END $$;

---------------------------------------------------------------- 7. definer flows still work
DO $$
DECLARE
  hh_spouse_target uuid;
  r text;
  v_link jsonb;
BEGIN
  -- Signup (service role inserts the row) + link_household_on_signup.
  -- The spouse row in `other`'s household names spouse@t315.test.
  UPDATE public.users SET created_at = now() WHERE id = pg_temp.id('spouse');
  INSERT INTO public.household_members (household_id, user_id, relationship, full_name, email, created_at)
  VALUES (current_setting('t315.hh_other')::uuid, pg_temp.id('other'), 'spouse', 'Spouse T315', 'spouse@t315.test', now() - interval '1 day');
  v_link := public.link_household_on_signup(pg_temp.id('spouse'));
  PERFORM pg_temp.expect('signup: link_household_on_signup finds the spouse row',
    (SELECT pending_household_id::text FROM public.users WHERE id = pg_temp.id('spouse')),
    current_setting('t315.hh_other'));

  r := pg_temp.keep('spouse', 'SELECT public.confirm_household_link()::text');
  PERFORM pg_temp.expect('confirm_household_link runs for the user', r::jsonb->>'status', 'linked');
  PERFORM pg_temp.expect('confirm_household_link moved household_id',
    (SELECT household_id::text FROM public.users WHERE id = pg_temp.id('spouse')), current_setting('t315.hh_other'));
  PERFORM pg_temp.expect('linked user can read the household members',
    pg_temp.keep('spouse', 'SELECT count(*)::text FROM public.household_members'), '2');

  r := pg_temp.keep('spouse', 'SELECT public.unlink_household()::text');
  PERFORM pg_temp.expect('unlink_household runs for the user', r::jsonb->>'status', 'unlinked');
  PERFORM pg_temp.expect('unlink gave a new household',
    (SELECT (household_id IS DISTINCT FROM current_setting('t315.hh_other')::uuid)::text FROM public.users WHERE id = pg_temp.id('spouse')), 'true');

  r := pg_temp.keep('stu', format('SELECT public.ensure_household(%L)::text', pg_temp.id('stu')));
  PERFORM pg_temp.expect('ensure_household sets household_id for the user',
    (SELECT household_id::text FROM public.users WHERE id = pg_temp.id('stu')), r);

  r := pg_temp.keep('stu', 'SELECT public.decline_household_link()::text');
  PERFORM pg_temp.expect('decline_household_link runs for the user', r::jsonb->>'status', 'declined');

  -- Contact link: set by the service role, read through get_my_contact_id().
  UPDATE public.users SET contact_id = current_setting('t315.c_other')::uuid WHERE id = pg_temp.id('me');
  PERFORM pg_temp.expect('get_my_contact_id after a service-role link',
    pg_temp.keep('me', 'SELECT public.get_my_contact_id()::text'), current_setting('t315.c_other'));
  PERFORM pg_temp.expect('linked contact readable by its user',
    pg_temp.keep('me', 'SELECT count(*)::text FROM public.contacts'), '1');
END $$;

---------------------------------------------------------------- 8. department trigger still adds members
DO $$
BEGIN
  PERFORM pg_temp.keep('adm', format($s$UPDATE public.users SET department = 'media_t315' WHERE id = %L RETURNING id::text$s$, pg_temp.id('other')));
  PERFORM pg_temp.keep('me', format($s$UPDATE public.users SET department = 'media_t315' WHERE id = %L RETURNING id::text$s$, pg_temp.id('me')));
  PERFORM pg_temp.keep('adm', format($s$UPDATE public.users SET department = 'leadership_team' WHERE id = %L RETURNING id::text$s$, pg_temp.id('tgt')));
  PERFORM pg_temp.expect('admin-set department added the roster row',
    (SELECT count(*)::text FROM public.staff_ministry_members m JOIN public.staff_ministries s ON s.id = m.staff_ministry_id
      WHERE m.user_id = pg_temp.id('other') AND s.slug = 'media_t315' AND m.status = 'active'), '1');
  PERFORM pg_temp.expect('self-set department (media) added the roster row',
    (SELECT count(*)::text FROM public.staff_ministry_members m JOIN public.staff_ministries s ON s.id = m.staff_ministry_id
      WHERE m.user_id = pg_temp.id('me') AND s.slug = 'media_t315'), '1');
  PERFORM pg_temp.expect('... and the leadership_team role follows',
    (SELECT count(*)::text FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = pg_temp.id('tgt') AND r.name = 'leadership_team'), '1');
  PERFORM pg_temp.expect('me never got leadership_team',
    (SELECT count(*)::text FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = pg_temp.id('me') AND r.name = 'leadership_team'), '0');
  -- Reactivation by the service role still re-adds the department roster row.
  UPDATE public.users SET department = 'media_t315' WHERE id = pg_temp.id('off');
  UPDATE public.users SET is_active = true WHERE id = pg_temp.id('off');
  PERFORM pg_temp.expect('service-role reactivation re-adds the roster row',
    (SELECT count(*)::text FROM public.staff_ministry_members m JOIN public.staff_ministries s ON s.id = m.staff_ministry_id
      WHERE m.user_id = pg_temp.id('off') AND s.slug = 'media_t315'), '1');
END $$;

---------------------------------------------------------------- 8b. department whitespace / trim (should-fix a)
DO $$
DECLARE dep text;
BEGIN
  -- self-edits
  PERFORM pg_temp.keep('me', format($s$UPDATE public.users SET department = '   ' WHERE id = %L RETURNING coalesce(department, '<null>')$s$, pg_temp.id('me')));
  PERFORM pg_temp.expect('self: spaces-only department stored as NULL',
    (SELECT coalesce(department, '<null>') FROM public.users WHERE id = pg_temp.id('me')), '<null>');
  PERFORM pg_temp.keep('me', format($s$UPDATE public.users SET department = 'media_t315' WHERE id = %L RETURNING id::text$s$, pg_temp.id('me')));
  PERFORM pg_temp.keep('me', format($s$UPDATE public.users SET department = E'\t\n \u00a0' WHERE id = %L RETURNING id::text$s$, pg_temp.id('me')));
  PERFORM pg_temp.expect('self: tab/newline/nbsp-only department stored as NULL',
    (SELECT coalesce(department, '<null>') FROM public.users WHERE id = pg_temp.id('me')), '<null>');
  PERFORM pg_temp.expect('self: empty string department stored as NULL',
    pg_temp.keep('me', format($s$UPDATE public.users SET department = '' WHERE id = %L RETURNING coalesce(department, '<null>')$s$, pg_temp.id('me'))), '<null>');
  PERFORM pg_temp.expect('self: padded valid slug accepted and trimmed',
    pg_temp.keep('me', format($s$UPDATE public.users SET department = '  media_t315  ' WHERE id = %L RETURNING department$s$, pg_temp.id('me'))), 'media_t315');
  PERFORM pg_temp.expect('self: padded valid slug still makes the roster row',
    (SELECT count(*)::text FROM public.staff_ministry_members m JOIN public.staff_ministries s ON s.id = m.staff_ministry_id
      WHERE m.user_id = pg_temp.id('me') AND s.slug = 'media_t315' AND m.status = 'active'), '1');
  PERFORM pg_temp.expect('self: padded resend of the same slug is a no-op',
    pg_temp.keep('me', format($s$UPDATE public.users SET department = ' media_t315', phone = '0825555555' WHERE id = %L RETURNING department$s$, pg_temp.id('me'))), 'media_t315');
  PERFORM pg_temp.expect('self: padded leadership_team still refused',
    pg_temp.upd('me','me', $s$department = '  leadership_team '$s$), 'err 42501');
  PERFORM pg_temp.expect('self: tab-padded leadership_team still refused',
    pg_temp.upd('me','me', $s$department = E'\tleadership_team\n'$s$), 'err 42501');
  PERFORM pg_temp.expect('self: padded part-time slug still refused',
    pg_temp.upd('me','me', $s$department = ' hope_t315 '$s$), 'err 42501');
  PERFORM pg_temp.expect('self: padded unknown slug still refused',
    pg_temp.upd('me','me', $s$department = ' nope_t315 '$s$), 'err 42501');
  PERFORM pg_temp.expect('student: padded main slug still refused',
    pg_temp.upd('stu','stu', $s$department = ' media_t315 '$s$), 'err 42501');
  PERFORM pg_temp.expect('student: blank department is allowed (stays NULL, no roster row)',
    pg_temp.keep('stu', format($s$UPDATE public.users SET department = '  ' WHERE id = %L RETURNING coalesce(department, '<null>')$s$, pg_temp.id('stu'))), '<null>');
  PERFORM pg_temp.expect('student: still no staff roster rows',
    (SELECT count(*)::text FROM public.staff_ministry_members WHERE user_id = pg_temp.id('stu')), '0');
  -- admins through the user client
  PERFORM pg_temp.expect('admin: padded leadership_team stored trimmed',
    pg_temp.keep('adm', format($s$UPDATE public.users SET department = ' leadership_team  ' WHERE id = %L RETURNING department$s$, pg_temp.id('spouse'))), 'leadership_team');
  PERFORM pg_temp.expect('admin: padded leadership_team still grants the role (slug matched)',
    (SELECT count(*)::text FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = pg_temp.id('spouse') AND r.name = 'leadership_team'), '1');
  PERFORM pg_temp.expect('admin: blank department stored as NULL',
    pg_temp.keep('adm', format($s$UPDATE public.users SET department = E' \t ' WHERE id = %L RETURNING coalesce(department, '<null>')$s$, pg_temp.id('other'))), '<null>');
  -- service role (not otherwise checked) is normalised too
  UPDATE public.users SET department = '   ' WHERE id = pg_temp.id('sa');
  PERFORM pg_temp.expect('owner/service: blank department stored as NULL',
    (SELECT coalesce(department, '<null>') FROM public.users WHERE id = pg_temp.id('sa')), '<null>');
  PERFORM pg_temp.expect('service role: padded slug stored trimmed',
    pg_temp.try('service', format($s$UPDATE public.users SET department = ' media_t315 ' WHERE id = %L AND department IS NULL$s$, pg_temp.id('sa'))), 'rows=1');
  UPDATE public.users SET department = ' media_t315 ' WHERE id = pg_temp.id('sa');
  PERFORM pg_temp.expect('owner/service: padded slug stored trimmed',
    (SELECT department FROM public.users WHERE id = pg_temp.id('sa')), 'media_t315');
  PERFORM pg_temp.expect('no stored department has surrounding whitespace',
    (SELECT count(*)::text FROM public.users WHERE department IS NOT NULL AND (department <> btrim(department) OR department = '')), '0');
END $$;

---------------------------------------------------------------- 8c. definer path still creates users (should-fix b)
-- No SECURITY DEFINER function on prod inserts into public.users and there is
-- no trigger on auth.users; this models one (owned by the migration owner) so
-- the revoke is proven not to block that path if one is added.
CREATE FUNCTION public.t315_definer_create_user(p_id uuid, p_email text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $f$
BEGIN
  INSERT INTO public.users (id, email, first_name, last_name) VALUES (p_id, p_email, 'Def', 'T315');
  RETURN p_id::text;
END $f$;
GRANT EXECUTE ON FUNCTION public.t315_definer_create_user(uuid, text) TO authenticated;
DO $$
DECLARE nid uuid := gen_random_uuid(); r text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (nid, 'def@t315.test');
  r := pg_temp.keep('me', format($s$SELECT public.t315_definer_create_user(%L, 'def@t315.test')$s$, nid));
  PERFORM pg_temp.expect('definer function called by authenticated creates a user', r, nid::text);
  PERFORM pg_temp.expect('definer-created row exists',
    (SELECT count(*)::text FROM public.users WHERE id = nid), '1');
  nid := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (nid, 'own@t315.test');
  INSERT INTO public.users (id, email) VALUES (nid, 'own@t315.test');
  PERFORM pg_temp.expect('owner (migrations / SQL editor) still inserts a user',
    (SELECT count(*)::text FROM public.users WHERE id = nid), '1');
END $$;
DROP FUNCTION public.t315_definer_create_user(uuid, text);

---------------------------------------------------------------- 9. grants as shipped
DO $$
BEGIN
  PERFORM pg_temp.expect('anon has no write privilege',
    (SELECT has_table_privilege('anon','public.users','INSERT') OR has_table_privilege('anon','public.users','UPDATE')
         OR has_table_privilege('anon','public.users','DELETE') OR has_table_privilege('anon','public.users','TRUNCATE')
         OR has_any_column_privilege('anon','public.users','UPDATE'))::text, 'false');
  PERFORM pg_temp.expect('authenticated: no INSERT privilege',
    has_table_privilege('authenticated','public.users','INSERT')::text, 'false');
  PERFORM pg_temp.expect('dead admin INSERT policy dropped',
    (SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' AND cmd IN ('INSERT','ALL')), '0');
  PERFORM pg_temp.expect('service_role keeps INSERT',
    has_table_privilege('service_role','public.users','INSERT')::text, 'true');
  PERFORM pg_temp.expect('authenticated: no table-wide UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER',
    (SELECT has_table_privilege('authenticated','public.users','UPDATE') OR has_table_privilege('authenticated','public.users','DELETE')
         OR has_table_privilege('authenticated','public.users','TRUNCATE') OR has_table_privilege('authenticated','public.users','REFERENCES')
         OR has_table_privilege('authenticated','public.users','TRIGGER'))::text, 'false');
  PERFORM pg_temp.expect('authenticated column UPDATE count',
    (SELECT count(*)::text FROM pg_attribute a
      WHERE a.attrelid = 'public.users'::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')), '39');
  PERFORM pg_temp.expect('guard trigger is search_path-pinned',
    (SELECT proconfig::text FROM pg_proc WHERE proname = 'users_guard_privileged_self_update'), '{"search_path=\"\""}');
  PERFORM pg_temp.expect('guard is SECURITY INVOKER',
    (SELECT (NOT prosecdef)::text FROM pg_proc WHERE proname = 'users_guard_privileged_self_update'), 'true');
END $$;

DO $$
DECLARE np int; nf int; r record;
BEGIN
  SELECT count(*) FILTER (WHERE got IS NOT DISTINCT FROM want), count(*) FILTER (WHERE got IS DISTINCT FROM want)
    INTO np, nf FROM t315;
  FOR r IN SELECT * FROM t315 WHERE got IS DISTINCT FROM want ORDER BY n LOOP
    RAISE WARNING 'FAIL % | got % | want %', r.label, r.got, r.want;
  END LOOP;
  RAISE WARNING 'users_self_update_lockdown: % passed, % failed', np, nf;
  IF nf > 0 THEN RAISE EXCEPTION 'users_self_update_lockdown: % checks failed', nf; END IF;
END $$;
ROLLBACK;
