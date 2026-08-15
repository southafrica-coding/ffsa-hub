# Prayer Room — data model

The visual redesign is a restyle. This is not: it is a feature build.
Do the schema first, then the wall.

Postgres / Supabase. Names are suggestions; the RULES are not.

## Tables

```sql
-- A named seat that can exist on a set. Reference data, ~10 rows.
create table prayer_seat_types (
  id            text primary key,          -- 'prayer_lead' | 'worship_lead' | 'keys' | ...
  label         text not null,             -- 'PRAYER LEAD'
  category      text not null,             -- 'lead' | 'worship' | 'intercession' | 'tech'
  sort_order    int  not null
);

-- A block of time in the prayer room.
create table prayer_sets (
  id            uuid primary key default gen_random_uuid(),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,      -- duration is derived, never stored as "slots"
  title         text,
  focus         text,                      -- "what we're praying"
  type          text not null,             -- 'intercession' | 'worship' | 'prophetic'
  band_id       uuid references prayer_bands(id),  -- non-null = curated band instance
  created_by    uuid references auth.users(id),
  constraint sane_times check (ends_at > starts_at)
);

-- Morning / Noon / Night. Curated centrally, not booked.
create table prayer_bands (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,             -- 'MORNING'
  start_time    time not null,             -- 08:00
  end_time      time not null,             -- 09:30
  weekdays      int[] not null default '{1,2,3,4,5}',
  weekly_focus  text,
  lead_user_id  uuid references auth.users(id),
  updated_by    uuid references auth.users(id),
  updated_at    timestamptz default now()
);

-- One row per seat on a set. Absence of a row = that seat is not offered.
create table prayer_set_seats (
  id            uuid primary key default gen_random_uuid(),
  set_id        uuid not null references prayer_sets(id) on delete cascade,
  seat_type_id  text not null references prayer_seat_types(id),
  user_id       uuid references auth.users(id),   -- null = seat open
  filled_at     timestamptz,
  unique (set_id, seat_type_id, user_id)
);

-- Per-seat qualification. THE core of the module.
create table prayer_qualifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  seat_type_id  text not null references prayer_seat_types(id),
  state         text not null,             -- 'not_evaluated' | 'in_training' | 'signed_off'
  updated_at    timestamptz default now(),
  unique (user_id, seat_type_id)
);

-- An evaluation event. TWO note fields with DIFFERENT visibility.
create table prayer_evaluations (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id),   -- who was evaluated
  evaluator_id   uuid not null references auth.users(id),
  seat_type_id   text not null references prayer_seat_types(id),
  outcome        text not null,            -- 'not_yet' | 'in_training' | 'signed_off'
  feedback       text,                     -- VISIBLE TO THE PERSON
  private_note   text,                     -- EVALUATORS ONLY
  observed_set   uuid references prayer_sets(id),
  created_at     timestamptz default now()
);

-- Someone asking for a specific open seat.
create table prayer_seat_requests (
  id            uuid primary key default gen_random_uuid(),
  set_id        uuid not null references prayer_sets(id) on delete cascade,
  seat_type_id  text not null references prayer_seat_types(id),
  user_id       uuid not null references auth.users(id),
  state         text not null default 'pending',  -- 'pending' | 'accepted' | 'declined'
  created_at    timestamptz default now(),
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz
);

-- Someone asking to be evaluated for a seat.
create table prayer_evaluation_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id),
  seat_type_id  text not null references prayer_seat_types(id),
  state         text not null default 'waiting',  -- 'waiting' | 'booked' | 'done'
  scheduled_at  timestamptz,
  evaluator_id  uuid references auth.users(id),
  created_at    timestamptz default now()
);
```

## The evaluator permission

Granted on the hub profile, alongside existing module permissions — NOT a prayer-room-local flag.

```sql
-- scope: 'all' | 'worship' | 'intercession' | 'tech'  (matches prayer_seat_types.category)
create table prayer_evaluators (
  user_id  uuid primary key references auth.users(id),
  scope    text not null default 'all',
  granted_by uuid references auth.users(id),
  granted_at timestamptz default now()
);
```

Only a user in `prayer_evaluators` may write `prayer_evaluations`, may change
`prayer_qualifications`, and may edit `prayer_bands`. Scope restricts which
`seat_type_id` values they may act on.

## Rules the UI depends on

1. **A set is live if at least one of `prayer_lead` / `worship_lead` is filled.**
   Not live ⇒ the wall draws a dashed white block reading NEEDS A LEAD, and the
   remaining seats are locked (no requests, no filling) until a lead exists.

2. **Prayer lead and worship lead are separate qualifications.** Holding one grants
   nothing about the other. Never collapse them into a generic "lead".

3. **Seat filling is qualification-gated.** The picker offers only users whose
   `prayer_qualifications.state = 'signed_off'` for that seat, sorted by ascending
   set count over the trailing 30 days. In-training users are shown, flagged, and
   selectable only with an explicit override that notifies evaluators.

4. **Clash detection.** A user cannot hold two seats whose sets overlap in time.
   Surface the clash in the picker ("On Selah at 09:30") rather than blocking silently.

5. **Note visibility — enforce in RLS, not just the UI.**
   - `feedback`: readable by the subject, by any evaluator.
   - `private_note`: readable by evaluators ONLY. Never returned to the subject's
     own profile query. A set lead filling a seat sees neither note — only
     `prayer_qualifications.state`.

6. **Curated bands are not bookable.** A set with `band_id` set cannot be claimed
   or deleted by a non-evaluator, and does not appear as available time.

7. **Unbooked time is not a row.** There is no "empty slot" record. The wall derives
   gaps by subtracting sets from the day. Do not create placeholder rows.

## Suggested RLS sketch

```sql
alter table prayer_evaluations enable row level security;

create policy "subject reads feedback only"
  on prayer_evaluations for select
  using (
    auth.uid() = user_id
    or exists (select 1 from prayer_evaluators e where e.user_id = auth.uid())
  );
-- and expose private_note through an evaluator-only VIEW rather than the base
-- table, so a subject SELECT can never return the column at all.

create view prayer_evaluations_for_subject as
  select id, user_id, evaluator_id, seat_type_id, outcome, feedback, created_at
  from prayer_evaluations;
```
