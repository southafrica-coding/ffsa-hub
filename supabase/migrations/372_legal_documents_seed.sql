-- DO NOT APPLY until Jack says so.
-- ============================================================
-- FFSA Hub — Migration 372: Legal → Documents (seed)
-- ============================================================
-- 1. A DRAFT list of document types. Every row is is_confirmed = false
--    and has no fixed validity unless it is well known: the legal officer
--    confirms or corrects each one in the app. Nothing here is a legal
--    deadline.
-- 2. The access list: the legal officer (owner) and two reviewers while
--    the module is built and tested. Remove the reviewer rows before
--    go-live (see docs/legal-documents.md).
-- 3. Two starting folders.
--
-- No personal data: no names, numbers or dates of any document. Users are
-- referenced by id only, and only if the account exists.
-- Idempotent: ON CONFLICT DO NOTHING / NOT EXISTS.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. DRAFT DOCUMENT TYPES
-- ────────────────────────────────────────────────────────────
INSERT INTO public.legal_document_types
  (key, name, category, issuer, valid_months, lead_days, guidance, sort_order)
VALUES
  -- Organisation
  ('npo_registration',      'NPO registration certificate',          'organisation', 'Department of Social Development', NULL,  90, 'Draft. Annual reports keep it in good standing; confirm the due date.', 10),
  ('pbo_approval',          'PBO approval (section 18A)',            'organisation', 'SARS',                             NULL,  90, 'Draft. Confirm what needs renewing and when.',                         20),
  ('tax_compliance_pin',    'Tax compliance status PIN',             'organisation', 'SARS',                             NULL,  30, 'Draft. Confirm how long a PIN stays valid for each use.',              30),
  ('cipc_annual_return',    'CIPC annual return',                    'organisation', 'CIPC',                              12,   60, 'Draft. Confirm the filing window for FFSA.',                           40),
  ('company_registration',  'Company registration (NPC)',            'organisation', 'CIPC',                             NULL,   0, 'Draft. No expiry expected.',                                          50),
  ('bbbee_affidavit',       'B-BBEE affidavit',                      'organisation', NULL,                                12,   60, 'Draft. Confirm whether FFSA needs one.',                               60),
  ('coida_good_standing',   'COIDA letter of good standing',         'organisation', 'Compensation Fund',                 12,   60, 'Draft. Confirm.',                                                      70),
  ('insurance_policy',      'Insurance policy',                      'organisation', NULL,                                12,   60, 'Draft. One row per policy.',                                           80),
  ('lease_agreement',       'Lease agreement',                       'organisation', NULL,                               NULL,  90, 'Draft. Set the expiry from the lease.',                               90),
  ('audit_report',          'Annual financial statements / audit',  'organisation', NULL,                                12,   90, 'Draft. Confirm the year end and deadline.',                          100),
  -- Personal
  ('id_document',           'ID document / smart ID card',           'personal',     'Home Affairs',                     NULL,   0, 'Draft.',                                                              200),
  ('passport',              'Passport',                              'personal',     NULL,                               NULL, 270, 'Draft. Many countries want 6+ months left on arrival; confirm lead time.', 210),
  ('visa_permit',           'Visa or permit',                        'personal',     NULL,                               NULL, 120, 'Draft. One row per visa or permit.',                                 220),
  ('police_clearance',      'Police clearance certificate',          'personal',     'SAPS',                             NULL,  60, 'Draft. Confirm how recent the receiving body needs it.',            230),
  ('drivers_licence',       'Driving licence card',                  'personal',     'Department of Transport',          NULL,  90, 'Draft.',                                                              240),
  ('first_aid',             'First aid certificate',                 'personal',     NULL,                               NULL,  60, 'Draft.',                                                              250),
  ('other_certificate',     'Other certificate',                     'personal',     NULL,                               NULL,  60, 'Draft.',                                                              260)
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────
-- 2. ACCESS LIST (only for accounts that exist)
-- ────────────────────────────────────────────────────────────
INSERT INTO public.legal_access (user_id, access_role, note)
SELECT v.user_id, v.access_role, v.note
  FROM (VALUES
    ('33b75686-f0f5-4922-93ae-3b52250356e5'::uuid, 'owner',    'Legal officer'),
    ('5fdf31ec-4183-4dec-8ef1-09a3230b44da'::uuid, 'reviewer', 'Build and test. Remove before go-live.'),
    ('26d4b510-0779-41bc-977d-4b2796fe4852'::uuid, 'reviewer', 'Build and test. Remove before go-live.')
  ) AS v(user_id, access_role, note)
  JOIN public.users u ON u.id = v.user_id
 WHERE NOT EXISTS (
   SELECT 1 FROM public.legal_access a
    WHERE a.user_id = v.user_id AND a.folder_id IS NULL
 );

-- ────────────────────────────────────────────────────────────
-- 3. STARTING FOLDERS
-- ────────────────────────────────────────────────────────────
INSERT INTO public.legal_folders (name, kind, description, sort_order)
SELECT v.name, v.kind, v.description, v.sort_order
  FROM (VALUES
    ('FFSA legal',     'organisation', 'Registrations, tax, insurance, leases and other organisation papers.', 10),
    ('Personal papers', 'personal',    'The legal officer''s own documents and certificates.',                  20)
  ) AS v(name, kind, description, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM public.legal_folders f WHERE f.name = v.name);

-- ============================================================
-- Validation (run after applying)
-- ------------------------------------------------------------
--   SELECT count(*) FROM public.legal_document_types;               -- 17
--   SELECT access_role, count(*) FROM public.legal_access GROUP BY 1; -- owner 1, reviewer 2
--   SELECT name, kind FROM public.legal_folders ORDER BY sort_order;  -- 2 rows
-- ============================================================
