-- ════════════════════════════════════════════════════════════
-- 246 — Donor statements: sender and wording (phase 2)
-- ════════════════════════════════════════════════════════════
-- Who the statement email comes from, where replies go, and the words on
-- the PDF and in the email — all editable in Finance → Donor Statements →
-- Settings, defaulting to the wording finance signed off (Ellen, Oct 2026).
--
-- The email body is a template. Placeholders are filled per donor:
--   [Donor Name] [Year] [total]             — this donor's statement
--   [Organization] [Tax ID] [Signer Name] [Signer Title] [Address]
--                                           — from the settings above, so
--                                             the address changes in one place
--
-- The mission and IRS paragraphs print on the PDF word for word. The IRS
-- paragraph is the written acknowledgment donors need for gifts of $250+.
--
-- Idempotent. Safe to re-run.
-- ────────────────────────────────────────────────────────────

ALTER TABLE public.donor_statement_settings
  ADD COLUMN IF NOT EXISTS from_name    text NOT NULL DEFAULT 'FF SA USA, INC',
  ADD COLUMN IF NOT EXISTS from_email   text NOT NULL DEFAULT 'admin@ffsouthafrica.com',
  ADD COLUMN IF NOT EXISTS reply_to     text NOT NULL DEFAULT 'finance@ffsouthafrica.com',
  ADD COLUMN IF NOT EXISTS email_subject text NOT NULL
    DEFAULT '[Year] Giving Statement - Thank You for Your Generosity!',
  ADD COLUMN IF NOT EXISTS email_body   text NOT NULL DEFAULT $body$Dear [Donor Name],

On behalf of [Organization], we want to express our deepest gratitude for your generous contributions throughout the year.

You are receiving this statement because you made a donation through [Organization] to Fire & Fragrance South Africa or Missio Church.

Your partnership enables us to advance our mission through worship & prayer, evangelism, discipleship, media, ending Bible poverty, and mercy ministries across South Africa and beyond. Your support is making a tangible impact in lives and communities.

Your total donation for [Year] is: $[total].

Attached is a detailed statement of all your donations. Your continued support helps us fulfill our mission and make a lasting impact in the lives of those we serve.

As a registered 501(c)(3) tax-exempt organization (EIN: [Tax ID]), we want to confirm that no goods or services were provided in exchange for this donation. Therefore, your contribution is fully tax-deductible to the extent allowed by law.

If you have any questions or require additional information, please don't hesitate to respond to this email.

We are deeply grateful for your generosity and for your role in supporting the work of the Kingdom. Together, we are changing lives for eternity.

With blessings and gratitude,

[Signer Name]
[Signer Title]
[Organization]
[Address]$body$,
  ADD COLUMN IF NOT EXISTS mission_paragraph text NOT NULL DEFAULT
    'Your partnership enables us to advance our mission through worship & prayer, evangelism, discipleship, media, ending Bible poverty, and mercy ministries across South Africa and beyond. Your support is making a tangible impact in lives and communities.',
  ADD COLUMN IF NOT EXISTS irs_paragraph text NOT NULL DEFAULT
    'This letter serves as a record of your charitable contributions. No goods or services were provided in exchange for these donations. Your donations are tax-deductible to the extent allowed by law.',
  ADD COLUMN IF NOT EXISTS closing_line text NOT NULL DEFAULT 'With blessings and gratitude,';

-- ============================================================
-- Verify:
--   SELECT from_email, reply_to, email_subject, left(email_body, 40)
--   FROM public.donor_statement_settings;
-- ============================================================
