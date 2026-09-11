-- ============================================================
-- Migration 001: profiles
-- Extends Supabase Auth users with a role (admin | usher).
-- Both admin and ushers log in through Supabase Auth (email+password
-- for admin, a "username@usher.local" style email for the shared
-- usher account) — this avoids storing plaintext passwords ourselves
-- and lets Row Level Security key off auth.uid().
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'usher')),
  username text unique,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: is the current user an admin?
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and is_active = true
  );
$$;

-- Helper: is the current user an active usher (or admin)?
create or replace function public.is_usher_or_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'usher') and is_active = true
  );
$$;

create policy "Admins can view all profiles"
  on public.profiles for select
  using (public.is_admin() or id = auth.uid());

create policy "Admins can manage profiles"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());
