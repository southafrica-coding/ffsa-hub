-- 317_user_access_holds.sql
--
-- Hold an account's HUB access until a date (Gap Year / FFSAX 2027: no access
-- until 15 Jan 2027, a month before the school starts).
--
-- Migration 230 only held back the SETUP LINK for students accepted after
-- 13 Oct 2026. Students accepted earlier already had working accounts, and
-- "Forgot password" let held students in early. This is the actual gate: the
-- middleware refuses every signed-in request (web and phone app) from an
-- account whose hold date hasn't arrived. It lifts by itself on the date.
--
-- Its own table, not a users column: until 315 is applied, a signed-in user
-- can PATCH their own users row and could clear the hold. Here they can only
-- READ their own row (the middleware reads it with their session); every
-- write is service-role.

create table if not exists public.user_access_holds (
  user_id uuid primary key references public.users(id) on delete cascade,
  opens_on date not null,
  reason text,
  program_id uuid references public.programs(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null
);

alter table public.user_access_holds enable row level security;

revoke all on public.user_access_holds from anon, authenticated;
grant select on public.user_access_holds to authenticated;

drop policy if exists "Users read own access hold" on public.user_access_holds;
create policy "Users read own access hold"
  on public.user_access_holds
  for select
  to authenticated
  using (user_id = auth.uid());

-- Backfill: every enrolled FFSAX 2027 student whose only roles are student /
-- self_service and who is in no other school. (Staff, admins and returning
-- students keep their access.) 44 people on 2026-11-10.
insert into public.user_access_holds (user_id, opens_on, reason, program_id)
select e.user_id, date '2027-01-15', 'Gap Year 2027: HUB opens a month before school', e.program_id
from public.enrollments e
join public.programs p on p.id = e.program_id
where p.code = 'FFSAX2027'
  and e.removed_at is null
  and e.user_id is not null
  and not exists (
    select 1 from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    where ur.user_id = e.user_id
      and r.name not in ('student', 'self_service')
  )
  and not exists (
    select 1 from public.enrollments e2
    where e2.user_id = e.user_id
      and e2.removed_at is null
      and e2.program_id <> e.program_id
  )
on conflict (user_id) do nothing;
