-- ============================================================
-- Migration 005: check_ins
-- Detailed attendance log. One row per check-in event. This is
-- the table Supabase Realtime listens to for the live attendance
-- counter on the Admin Dashboard.
-- ============================================================

create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  registrant_id uuid references public.registrants(id) on delete set null,

  sex text check (sex in ('male', 'female', 'group')),
  adults integer not null default 1,
  children integer not null default 0,

  checked_in_by uuid references auth.users(id),
  checked_in_at timestamptz not null default now()
);

alter table public.check_ins enable row level security;

create index if not exists check_ins_checked_in_at_idx on public.check_ins (checked_in_at);
create index if not exists check_ins_registrant_idx on public.check_ins (registrant_id);

create policy "Admins and ushers can view check-ins"
  on public.check_ins for select
  using (public.is_usher_or_admin());

create policy "Ushers and admins can record check-ins"
  on public.check_ins for insert
  with check (public.is_usher_or_admin());

-- Enable Realtime on this table (also confirm "Realtime" is ON for
-- this table in Database > Replication in the Supabase dashboard).
alter publication supabase_realtime add table public.check_ins;
