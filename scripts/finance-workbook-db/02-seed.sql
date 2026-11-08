-- Identities for the harness. Inserted as the database owner (bypasses RLS).
-- Later probes SET ROLE authenticated. That owner bypass is not an RLS result.

INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'finance@example.test'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'editor@example.test'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'approver@example.test'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'outsider@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, display_name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'Finance'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'Editor'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'Approver'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', 'Outsider')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', id FROM public.roles WHERE name = 'finance_admin'
ON CONFLICT DO NOTHING;

INSERT INTO public.user_roles (user_id, role_id)
SELECT 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', id FROM public.roles WHERE name = 'budget_approver'
ON CONFLICT DO NOTHING;

INSERT INTO public.programs (id, name, code)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'DTS', 'DTS')
ON CONFLICT (id) DO NOTHING;

-- Ministry leader. Not finance. Cannot read finance_orgs under policy 290.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'leader@example.test')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.users (id, display_name) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', 'Ministry leader')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.staff_ministries (id, name, slug)
VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', 'Worship', 'worship')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.staff_ministry_members (staff_ministry_id, user_id, member_role, status)
VALUES (
  'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5',
  'leader',
  'active'
)
ON CONFLICT (staff_ministry_id, user_id) DO NOTHING;
