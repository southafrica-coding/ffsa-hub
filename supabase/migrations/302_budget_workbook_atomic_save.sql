-- ─────────────────────────────────────────────────────────────────────────────
-- 302 — atomic budget workbook save
--
-- DRAFT ONLY. DO NOT APPLY to production or any shared database.
--
-- Depends on PR #475 migrations 295–299. Does not edit those files.
-- Does not create or alter budget_repayments (300) or budget_xero_spends
-- (301). Those numbers belong to PR #513.
--
-- One signed-in call creates a sheet or replaces the rows the caller sent.
-- Both functions are SECURITY INVOKER: budget policies still decide each
-- write. They do not read finance_orgs. Active NPC/ZAR is checked on insert
-- by finance_private.assert_south_africa_budget_org (SECURITY DEFINER,
-- search_path empty), which a ministry leader cannot call directly and
-- which a later save does not repeat. A transaction advisory lock on the
-- budget id is taken before the revision is read, so two workbook saves
-- cannot interleave. Direct SQL that does not call apply_budget_workbook
-- does not take that lock.
--
-- Once-only. Not safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.budgets') IS NULL
     OR to_regclass('public.budget_lines') IS NULL
     OR to_regclass('public.budget_expenses') IS NULL
     OR to_regprocedure('public.create_budget_from_template(uuid,text,uuid,uuid,uuid,text,text,text,numeric,boolean)') IS NULL THEN
    RAISE EXCEPTION
      'DO NOT APPLY 302_budget_workbook_atomic_save.sql until PR #475 migrations 295-299 are applied.';
  END IF;
END
$guard$;

CREATE FUNCTION finance_private.budget_lines_block_live_expense_archive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.archived_at IS NOT NULL
     AND OLD.archived_at IS NULL
     AND EXISTS (
       SELECT 1
       FROM public.budget_expenses e
       WHERE e.line_id = NEW.id
         AND e.budget_id = NEW.budget_id
         AND e.archived_at IS NULL
     ) THEN
    RAISE EXCEPTION 'A line with a live expense cannot be archived'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION finance_private.budget_lines_block_live_expense_archive()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER budget_lines_block_live_expense_archive
  BEFORE UPDATE ON public.budget_lines
  FOR EACH ROW EXECUTE FUNCTION finance_private.budget_lines_block_live_expense_archive();

CREATE FUNCTION public.apply_budget_workbook(
  p_budget_id uuid,
  p_expected_updated_at timestamptz,
  p_header jsonb,
  p_lines jsonb,
  p_expenses jsonb
) RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rev timestamptz;
  v_budget public.budgets%ROWTYPE;
  v_diff boolean;
  v_n integer;
  v_line jsonb;
  v_exp jsonb;
  v_id uuid;
  v_section uuid;
  v_kind text;
  v_name text;
  v_amount bigint;
  v_freq numeric;
  v_mult numeric;
  v_uses boolean;
  v_sort integer;
  v_notes text;
  v_found boolean;
  v_old public.budget_lines%ROWTYPE;
  v_olde public.budget_expenses%ROWTYPE;
  v_keep_lines uuid[] := ARRAY[]::uuid[];
  v_keep_expenses uuid[] := ARRAY[]::uuid[];
  v_protect uuid[] := ARRAY[]::uuid[];
  v_line_id uuid;
  v_date date;
  v_vendor text;
  v_description text;
  v_reference text;
BEGIN
  -- Held until this transaction ends. A second save of this budget waits,
  -- then sees the new revision. Re-entrant for this transaction.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ffsa-budget-workbook:' || p_budget_id::text, 0)
  );

  SELECT max(stamp) INTO v_rev
  FROM (
    SELECT b.updated_at AS stamp
    FROM public.budgets b
    WHERE b.id = p_budget_id AND b.archived_at IS NULL
    UNION ALL
    SELECT l.updated_at
    FROM public.budget_lines l
    WHERE l.budget_id = p_budget_id AND l.archived_at IS NULL
    UNION ALL
    SELECT e.updated_at
    FROM public.budget_expenses e
    WHERE e.budget_id = p_budget_id AND e.archived_at IS NULL
  ) s;

  IF v_rev IS NULL THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
  END IF;
  IF p_expected_updated_at IS NULL OR v_rev IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION 'workbook revision conflict' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_budget FROM public.budgets WHERE id = p_budget_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Budget not found' USING ERRCODE = 'P0002';
  END IF;

  v_diff := false;
  IF p_header IS NOT NULL THEN
    v_diff :=
      (jsonb_exists(p_header, 'name') AND btrim(p_header->>'name') IS DISTINCT FROM v_budget.name)
      OR (jsonb_exists(p_header, 'driver_label') AND (p_header->>'driver_label') IS DISTINCT FROM v_budget.driver_label)
      OR (jsonb_exists(p_header, 'driver_value') AND (p_header->>'driver_value')::numeric IS DISTINCT FROM v_budget.driver_value)
      OR (jsonb_exists(p_header, 'funding_goal_cents') AND (p_header->>'funding_goal_cents')::bigint IS DISTINCT FROM v_budget.funding_goal_cents)
      OR (jsonb_exists(p_header, 'funds_in_hand_cents') AND (p_header->>'funds_in_hand_cents')::bigint IS DISTINCT FROM v_budget.funds_in_hand_cents)
      OR (jsonb_exists(p_header, 'income_goal_cents') AND (p_header->>'income_goal_cents')::bigint IS DISTINCT FROM v_budget.income_goal_cents)
      OR (jsonb_exists(p_header, 'fundraising_goal_cents') AND (p_header->>'fundraising_goal_cents')::bigint IS DISTINCT FROM v_budget.fundraising_goal_cents)
      OR (jsonb_exists(p_header, 'notes') AND (p_header->>'notes') IS DISTINCT FROM v_budget.notes);
  END IF;

  IF v_diff THEN
    UPDATE public.budgets b
       SET name = CASE WHEN jsonb_exists(p_header, 'name') THEN btrim(p_header->>'name') ELSE b.name END,
           driver_label = CASE WHEN jsonb_exists(p_header, 'driver_label') THEN p_header->>'driver_label' ELSE b.driver_label END,
           driver_value = CASE WHEN jsonb_exists(p_header, 'driver_value') THEN (p_header->>'driver_value')::numeric ELSE b.driver_value END,
           funding_goal_cents = CASE WHEN jsonb_exists(p_header, 'funding_goal_cents') THEN (p_header->>'funding_goal_cents')::bigint ELSE b.funding_goal_cents END,
           funds_in_hand_cents = CASE WHEN jsonb_exists(p_header, 'funds_in_hand_cents') THEN (p_header->>'funds_in_hand_cents')::bigint ELSE b.funds_in_hand_cents END,
           income_goal_cents = CASE WHEN jsonb_exists(p_header, 'income_goal_cents') THEN (p_header->>'income_goal_cents')::bigint ELSE b.income_goal_cents END,
           fundraising_goal_cents = CASE WHEN jsonb_exists(p_header, 'fundraising_goal_cents') THEN (p_header->>'fundraising_goal_cents')::bigint ELSE b.fundraising_goal_cents END,
           notes = CASE WHEN jsonb_exists(p_header, 'notes') THEN p_header->>'notes' ELSE b.notes END
     WHERE b.id = p_budget_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_lines IS NOT NULL THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
      v_kind := v_line->>'kind';
      SELECT s.id INTO v_section
      FROM public.budget_sections s
      WHERE s.budget_id = p_budget_id AND s.key = v_kind;
      IF v_section IS NULL THEN
        RAISE EXCEPTION 'The budget is missing a section for that line' USING ERRCODE = '22023';
      END IF;
      v_id := NULLIF(v_line->>'id', '')::uuid;
      v_name := btrim(v_line->>'name');
      v_amount := (v_line->>'amount_cents')::bigint;
      v_freq := CASE WHEN v_kind = 'fixed' THEN 1 ELSE (v_line->>'frequency')::numeric END;
      v_mult := (v_line->>'multiplier')::numeric;
      v_uses := COALESCE((v_line->>'uses_driver')::boolean, false);
      v_sort := COALESCE((v_line->>'sort')::integer, 0);
      v_notes := v_line->>'notes';

      v_found := false;
      IF v_id IS NOT NULL THEN
        SELECT * INTO v_old
        FROM public.budget_lines
        WHERE id = v_id AND budget_id = p_budget_id AND archived_at IS NULL;
        v_found := FOUND;
      END IF;

      IF v_found
         AND v_old.section_id IS NOT DISTINCT FROM v_section
         AND v_old.kind IS NOT DISTINCT FROM v_kind
         AND v_old.name IS NOT DISTINCT FROM v_name
         AND v_old.amount_cents IS NOT DISTINCT FROM v_amount
         AND v_old.frequency IS NOT DISTINCT FROM v_freq
         AND v_old.multiplier IS NOT DISTINCT FROM v_mult
         AND v_old.uses_driver IS NOT DISTINCT FROM v_uses
         AND v_old.sort IS NOT DISTINCT FROM v_sort
         AND v_old.notes IS NOT DISTINCT FROM v_notes THEN
        v_keep_lines := v_keep_lines || v_id;
        CONTINUE;
      END IF;

      IF v_found THEN
        UPDATE public.budget_lines
           SET section_id = v_section,
               kind = v_kind,
               name = v_name,
               amount_cents = v_amount,
               frequency = v_freq,
               multiplier = v_mult,
               uses_driver = v_uses,
               sort = v_sort,
               notes = v_notes
         WHERE id = v_id AND budget_id = p_budget_id AND archived_at IS NULL;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> 1 THEN
          RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
        END IF;
      ELSE
        v_id := COALESCE(v_id, gen_random_uuid());
        INSERT INTO public.budget_lines (
          id, budget_id, section_id, kind, name, amount_cents, frequency, multiplier, uses_driver, sort, notes
        ) VALUES (
          v_id, p_budget_id, v_section, v_kind, v_name, v_amount, v_freq, v_mult, v_uses, v_sort, v_notes
        );
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> 1 THEN
          RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
        END IF;
      END IF;
      v_keep_lines := v_keep_lines || v_id;
    END LOOP;
  END IF;

  IF p_expenses IS NOT NULL THEN
    FOR v_exp IN SELECT value FROM jsonb_array_elements(p_expenses) LOOP
      v_line_id := NULLIF(v_exp->>'line_id', '')::uuid;
      IF v_line_id IS NOT NULL THEN
        IF p_lines IS NOT NULL AND NOT (v_line_id = ANY (v_keep_lines)) THEN
          RAISE EXCEPTION 'Expense must reference a live line of this budget' USING ERRCODE = '23514';
        END IF;
        IF p_lines IS NULL AND NOT EXISTS (
          SELECT 1 FROM public.budget_lines l
          WHERE l.id = v_line_id AND l.budget_id = p_budget_id AND l.archived_at IS NULL
        ) THEN
          RAISE EXCEPTION 'Expense must reference a live line of this budget' USING ERRCODE = '23514';
        END IF;
      END IF;
    END LOOP;

    FOR v_exp IN SELECT value FROM jsonb_array_elements(p_expenses) LOOP
      v_id := NULLIF(v_exp->>'id', '')::uuid;
      v_line_id := NULLIF(v_exp->>'line_id', '')::uuid;
      v_date := (v_exp->>'expense_date')::date;
      v_vendor := v_exp->>'vendor';
      v_description := v_exp->>'description';
      v_amount := (v_exp->>'amount_cents')::bigint;
      v_reference := v_exp->>'reference';
      v_notes := v_exp->>'notes';

      v_found := false;
      IF v_id IS NOT NULL THEN
        SELECT * INTO v_olde
        FROM public.budget_expenses
        WHERE id = v_id AND budget_id = p_budget_id AND archived_at IS NULL;
        v_found := FOUND;
      END IF;

      IF v_found
         AND v_olde.line_id IS NOT DISTINCT FROM v_line_id
         AND v_olde.expense_date IS NOT DISTINCT FROM v_date
         AND v_olde.vendor IS NOT DISTINCT FROM v_vendor
         AND v_olde.description IS NOT DISTINCT FROM v_description
         AND v_olde.amount_cents IS NOT DISTINCT FROM v_amount
         AND v_olde.reference IS NOT DISTINCT FROM v_reference
         AND v_olde.notes IS NOT DISTINCT FROM v_notes THEN
        v_keep_expenses := v_keep_expenses || v_id;
        CONTINUE;
      END IF;

      IF v_found THEN
        UPDATE public.budget_expenses
           SET line_id = v_line_id,
               expense_date = v_date,
               vendor = v_vendor,
               description = v_description,
               amount_cents = v_amount,
               reference = v_reference,
               notes = v_notes
         WHERE id = v_id AND budget_id = p_budget_id AND archived_at IS NULL;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> 1 THEN
          RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
        END IF;
      ELSE
        v_id := COALESCE(v_id, gen_random_uuid());
        INSERT INTO public.budget_expenses (
          id, budget_id, line_id, expense_date, vendor, description, amount_cents, reference, notes
        ) VALUES (
          v_id, p_budget_id, v_line_id, v_date, v_vendor, v_description, v_amount, v_reference, v_notes
        );
        GET DIAGNOSTICS v_n = ROW_COUNT;
        IF v_n <> 1 THEN
          RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
        END IF;
      END IF;
      v_keep_expenses := v_keep_expenses || v_id;
    END LOOP;

    SELECT count(*) INTO v_n
    FROM public.budget_expenses e
    WHERE e.budget_id = p_budget_id
      AND e.archived_at IS NULL
      AND NOT (e.id = ANY (v_keep_expenses));
    UPDATE public.budget_expenses
       SET archived_at = pg_catalog.now()
     WHERE budget_id = p_budget_id
       AND archived_at IS NULL
       AND NOT (id = ANY (v_keep_expenses));
    GET DIAGNOSTICS v_sort = ROW_COUNT;
    IF v_sort <> v_n THEN
      RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_lines IS NOT NULL THEN
    IF p_expenses IS NULL THEN
      SELECT COALESCE(array_agg(DISTINCT e.line_id), ARRAY[]::uuid[])
        INTO v_protect
      FROM public.budget_expenses e
      WHERE e.budget_id = p_budget_id AND e.archived_at IS NULL AND e.line_id IS NOT NULL;
    END IF;

    SELECT count(*) INTO v_n
    FROM public.budget_lines l
    WHERE l.budget_id = p_budget_id
      AND l.archived_at IS NULL
      AND NOT (l.id = ANY (v_keep_lines))
      AND NOT (l.id = ANY (v_protect));
    UPDATE public.budget_lines
       SET archived_at = pg_catalog.now()
     WHERE budget_id = p_budget_id
       AND archived_at IS NULL
       AND NOT (id = ANY (v_keep_lines))
       AND NOT (id = ANY (v_protect));
    GET DIAGNOSTICS v_sort = ROW_COUNT;
    IF v_sort <> v_n THEN
      RAISE EXCEPTION 'You can''t change this budget.' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT max(stamp) INTO v_rev
  FROM (
    SELECT b.updated_at AS stamp FROM public.budgets b WHERE b.id = p_budget_id AND b.archived_at IS NULL
    UNION ALL
    SELECT l.updated_at FROM public.budget_lines l WHERE l.budget_id = p_budget_id AND l.archived_at IS NULL
    UNION ALL
    SELECT e.updated_at FROM public.budget_expenses e WHERE e.budget_id = p_budget_id AND e.archived_at IS NULL
  ) s;
  RETURN v_rev;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_budget_workbook(uuid, timestamptz, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.apply_budget_workbook(uuid, timestamptz, jsonb, jsonb, jsonb) TO authenticated, service_role;

CREATE FUNCTION public.create_budget_workbook_sheet(
  p_template_id uuid,
  p_owner_kind text,
  p_owner_id uuid,
  p_period_id uuid,
  p_org_id uuid,
  p_name text,
  p_currency text,
  p_driver_label text,
  p_driver_value numeric,
  p_header jsonb,
  p_lines jsonb,
  p_expenses jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_rev timestamptz;
BEGIN
  v_id := public.create_budget_from_template(
    p_template_id, p_owner_kind, p_owner_id, p_period_id, p_org_id, p_name,
    p_currency, p_driver_label, p_driver_value, false
  );
  SELECT max(stamp) INTO v_rev
  FROM (
    SELECT b.updated_at AS stamp FROM public.budgets b WHERE b.id = v_id
    UNION ALL
    SELECT l.updated_at FROM public.budget_lines l WHERE l.budget_id = v_id AND l.archived_at IS NULL
    UNION ALL
    SELECT e.updated_at FROM public.budget_expenses e WHERE e.budget_id = v_id AND e.archived_at IS NULL
  ) s;
  PERFORM public.apply_budget_workbook(v_id, v_rev, p_header, p_lines, p_expenses);
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_budget_workbook_sheet(uuid, text, uuid, uuid, uuid, text, text, text, numeric, jsonb, jsonb, jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_budget_workbook_sheet(uuid, text, uuid, uuid, uuid, text, text, text, numeric, jsonb, jsonb, jsonb)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.apply_budget_workbook(uuid, timestamptz, jsonb, jsonb, jsonb) IS
  'Replace one workbook sheet in a single transaction. INVOKER. Locks the budget id, then requires p_expected_updated_at to match the latest live updated_at. Null p_lines or p_expenses leaves that list alone. A line with a live expense is not archived when expenses are omitted.';

COMMENT ON FUNCTION public.create_budget_workbook_sheet(uuid, text, uuid, uuid, uuid, text, text, text, numeric, jsonb, jsonb, jsonb) IS
  'Create a workbook from a template and its first lines and expenses in one transaction. INVOKER. p_currency null lets the org trigger store ZAR.';
