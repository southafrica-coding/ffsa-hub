-- ============================================================
-- Household linking — end-to-end test for migration 181
-- ------------------------------------------------------------
-- Exercises the whole spouse-linking matrix against a real database:
-- email normalisation, the pre-confirm blackout, confirm, the
-- created_at guard, claim-once, decline, the ambiguous-match refusal,
-- and unlink.
--
-- SAFE TO RUN ANYWHERE, INCLUDING PRODUCTION: every check runs inside
-- one DO block that ends in RAISE EXCEPTION, so the transaction always
-- aborts and none of the fixtures are ever written. The results come
-- back in the error message — an error here is the SUCCESS path; read
-- the PASS/FAIL lines in it.
-- ============================================================

DO $$
DECLARE
  uA uuid := gen_random_uuid();  -- Alice: fills the family in first
  uB uuid := gen_random_uuid();  -- Bob: signs up with the spouse email
  uC uuid := gen_random_uuid();  -- Carol: declines
  uD uuid := gen_random_uuid();  -- Dave: claimed by two households
  uE uuid := gen_random_uuid();  -- Erin: spouse row added AFTER her account
  hA uuid; hX uuid; hY uuid; hE uuid; hBnew uuid;
  r jsonb; v uuid; n int; b boolean; t timestamptz;
  out text := '';
BEGIN
  -- helper: record a check
  CREATE TEMP TABLE _res(n serial, name text, expected text, actual text, ok boolean) ON COMMIT DROP;

  -- ── fixtures ────────────────────────────────────────────────
  INSERT INTO public.users (id, email, first_name, last_name, status, created_at)
  VALUES (uA,'alice@test.invalid','Alice','Smith','active', now() - interval '10 days');
  PERFORM public.ensure_household(uA);
  SELECT household_id INTO hA FROM public.users WHERE id = uA;
  UPDATE public.households SET has_children = true WHERE id = hA;

  -- Alice records her spouse (Bob) and two children
  INSERT INTO public.household_members (household_id, user_id, relationship, full_name, first_name, last_name, email, created_at)
  VALUES (hA, uA, 'spouse', 'Bob Smith', 'Bob', 'Smith', '  BOB@Example.COM  ', now() - interval '9 days');
  INSERT INTO public.household_members (household_id, user_id, relationship, full_name, created_at)
  VALUES (hA, uA, 'child', 'Kid One', now() - interval '9 days'),
         (hA, uA, 'child', 'Kid Two', now() - interval '9 days');

  -- ── 1. email normalisation: case + whitespace must match ────
  INSERT INTO public.users (id, email, first_name, status, created_at)
  VALUES (uB,'bob@example.com','Bob','active', now());
  r := public.link_household_on_signup(uB);
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('match on messy-cased email','pending', r->>'status', r->>'status'='pending'),
    ('matched the right household', hA::text, r->>'household_id', (r->>'household_id')=hA::text);

  -- ── 2. pending grants NOTHING yet ───────────────────────────
  SELECT household_id, pending_household_id INTO v, hX FROM public.users WHERE id=uB;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('pre-confirm: not in the household','true', (v IS DISTINCT FROM hA)::text, v IS DISTINCT FROM hA),
    ('pre-confirm: pending is set', hA::text, hX::text, hX = hA);

  -- ── 3. confirm as Bob ───────────────────────────────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uB)::text, true);
  r := public.confirm_household_link();
  SELECT household_id, household_linked_at INTO v, t FROM public.users WHERE id=uB;
  SELECT count(*) INTO n FROM public.household_members WHERE household_id=hA;
  SELECT has_children INTO b FROM public.households WHERE id=hA;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('confirm links','linked', r->>'status', r->>'status'='linked'),
    ('Bob now in Alice''s household', hA::text, v::text, v=hA),
    ('linked_at stamped','true',(t IS NOT NULL)::text, t IS NOT NULL),
    ('Bob sees all 3 family records','3', n::text, n=3),
    ('has_children inherited (gate skipped)','true', b::text, b IS TRUE);

  SELECT count(*) INTO n FROM public.household_members
   WHERE household_id=hA AND relationship='spouse' AND linked_user_id=uB;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('spouse row claimed by Bob','1', n::text, n=1);

  -- ── 4. RLS: Bob really can read them; a stranger cannot ─────
  SELECT public.current_household_id() INTO v;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('current_household_id() as Bob', hA::text, v::text, v=hA);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid())::text, true);
  SELECT public.current_household_id() INTO v;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('stranger has no household','NULL', coalesce(v::text,'NULL'), v IS NULL);

  -- ── 5. already-claimed row cannot be claimed twice ──────────
  INSERT INTO public.users (id, email, first_name, status, created_at)
  VALUES (uC,'bob@example.com','Bob2','active', now());
  r := public.link_household_on_signup(uC);
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('2nd signup on a claimed row','none', r->>'status', r->>'status'='none');

  -- ── 6. decline ──────────────────────────────────────────────
  UPDATE public.users SET pending_household_id = hA WHERE id = uC;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uC)::text, true);
  r := public.decline_household_link();
  SELECT pending_household_id, household_link_declined_at INTO hX, t FROM public.users WHERE id=uC;
  SELECT household_id INTO v FROM public.users WHERE id=uC;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('decline clears pending','NULL', coalesce(hX::text,'NULL'), hX IS NULL),
    ('decline stamps declined_at','true',(t IS NOT NULL)::text, t IS NOT NULL),
    ('decline leaves own household','true',(v IS NOT NULL AND v<>hA)::text, v IS NOT NULL AND v<>hA);

  -- ── 7. ambiguous: two households claim one email ────────────
  INSERT INTO public.users (id, email, first_name, status, created_at)
  VALUES (gen_random_uuid(),'x1@test.invalid','X1','active', now() - interval '5 days')
  RETURNING id INTO v;
  PERFORM public.ensure_household(v); SELECT household_id INTO hX FROM public.users WHERE id=v;
  INSERT INTO public.household_members (household_id,user_id,relationship,full_name,email,created_at)
  VALUES (hX,v,'spouse','Dave D','dave@test.invalid', now() - interval '4 days');
  INSERT INTO public.users (id, email, first_name, status, created_at)
  VALUES (gen_random_uuid(),'x2@test.invalid','X2','active', now() - interval '5 days')
  RETURNING id INTO v;
  PERFORM public.ensure_household(v); SELECT household_id INTO hY FROM public.users WHERE id=v;
  INSERT INTO public.household_members (household_id,user_id,relationship,full_name,email,created_at)
  VALUES (hY,v,'spouse','Dave D','dave@test.invalid', now() - interval '4 days');

  INSERT INTO public.users (id,email,first_name,status,created_at)
  VALUES (uD,'dave@test.invalid','Dave','active', now());
  r := public.link_household_on_signup(uD);
  SELECT pending_household_id INTO hX FROM public.users WHERE id=uD;
  SELECT count(*) INTO n FROM public.audit_logs WHERE user_id=uD AND action='household_link_ambiguous';
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('two claimants -> no link','ambiguous', r->>'status', r->>'status'='ambiguous'),
    ('two claimants -> nothing pending','NULL', coalesce(hX::text,'NULL'), hX IS NULL),
    ('ambiguity audit-logged','1', n::text, n=1);

  -- ── 8. created_at guard: row added AFTER the account ────────
  INSERT INTO public.users (id,email,first_name,status,created_at)
  VALUES (uE,'erin@test.invalid','Erin','active', now() - interval '1 hour');
  INSERT INTO public.household_members (household_id,user_id,relationship,full_name,email,created_at)
  VALUES (hA,uA,'spouse','Erin E','erin@test.invalid', now());  -- created AFTER Erin's account
  r := public.link_household_on_signup(uE);
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('row added after the account is ignored','none', r->>'status', r->>'status'='none');

  -- ── 9. unlink: records stay put, gate re-runs ───────────────
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uB)::text, true);
  r := public.unlink_household();
  SELECT household_id INTO hBnew FROM public.users WHERE id=uB;
  SELECT count(*) INTO n FROM public.household_members WHERE household_id=hA;
  SELECT has_children INTO b FROM public.households WHERE id=hBnew;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('unlink moves Bob out','true',(hBnew<>hA)::text, hBnew<>hA),
    ('family records stay with Alice','4', n::text, n=4),
    ('leaver starts empty','0',(SELECT count(*) FROM public.household_members WHERE household_id=hBnew)::text,
       (SELECT count(*) FROM public.household_members WHERE household_id=hBnew)=0),
    ('leaver''s children gate re-runs','NULL', coalesce(b::text,'NULL'), b IS NULL);
  SELECT count(*) INTO n FROM public.household_members WHERE linked_user_id=uB;
  INSERT INTO _res(name,expected,actual,ok) VALUES
    ('spouse row released on unlink','0', n::text, n=0);

  -- ── report, then abort so nothing persists ──────────────────
  SELECT string_agg(
      (CASE WHEN ok THEN 'PASS  ' ELSE 'FAIL  ' END) || rpad(name,42) ||
      ' expected=' || expected || ' actual=' || actual, E'\n' ORDER BY n)
    INTO out FROM _res;
  SELECT count(*) FILTER (WHERE NOT ok) INTO n FROM _res;
  RAISE EXCEPTION E'\n===== HOUSEHOLD LINKING TEST =====\n%\n\n%\n(transaction deliberately aborted - no data written)',
    out, (CASE WHEN n=0 THEN 'ALL ' || (SELECT count(*) FROM _res) || ' CHECKS PASSED' ELSE n || ' CHECK(S) FAILED' END);
END $$;
