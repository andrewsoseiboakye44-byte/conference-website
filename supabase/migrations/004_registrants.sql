-- ============================================================
-- Migration 004: registrants
-- Core table for the 3-category registration funnel:
-- person, institution, church.
-- ============================================================

create table if not exists public.registrants (
  id uuid primary key default gen_random_uuid(),

  category text not null check (category in ('person', 'institution', 'church')),

  -- Shared fields
  full_name text not null,          -- person's name, institution name, or church name
  location text,
  contact_phone text not null,
  invited_by text,

  -- Person-only fields
  church_affiliation text,
  is_first_time boolean default false,

  -- Institution / Church-only fields
  number_of_members integer,

  -- Check-in state (denormalized flag for fast filtering;
  -- the detailed log lives in check_ins)
  is_checked_in boolean not null default false,
  checked_in_at timestamptz,

  -- Where the registration came from
  registered_via text not null default 'public' check (registered_via in ('public', 'admin', 'usher')),
  registered_by uuid references auth.users(id),

  created_at timestamptz not null default now()
);

alter table public.registrants enable row level security;

create index if not exists registrants_phone_idx on public.registrants (contact_phone);
create index if not exists registrants_category_idx on public.registrants (category);
create index if not exists registrants_checked_in_idx on public.registrants (is_checked_in);
create index if not exists registrants_created_at_idx on public.registrants (created_at);

-- Public (anonymous) visitors can INSERT their own registration,
-- and read back their newly created confirmation row within 60 seconds.
create policy "Anyone can register"
  on public.registrants for insert
  with check (registered_via = 'public');

create policy "Public registrants can read recent registration"
  on public.registrants for select
  using (registered_via = 'public' and created_at >= now() - interval '60 seconds');

-- Admins: full access.
create policy "Admins can manage all registrants"
  on public.registrants for all
  using (public.is_admin())
  with check (public.is_admin());

-- Ushers: can read, insert (door registrations), and update
-- (check-in status) — no delete.
create policy "Ushers can view registrants"
  on public.registrants for select
  using (public.is_usher_or_admin());

create policy "Ushers can register attendees at the door"
  on public.registrants for insert
  with check (public.is_usher_or_admin());

create policy "Ushers can update check-in status"
  on public.registrants for update
  using (public.is_usher_or_admin())
  with check (public.is_usher_or_admin());

-- Enable Realtime on this table so admin dashboard gets live registration events
alter publication supabase_realtime add table public.registrants;
