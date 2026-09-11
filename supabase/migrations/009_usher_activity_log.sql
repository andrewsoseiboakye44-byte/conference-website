-- ============================================================
-- Migration 009: usher_activity_log
-- Tracks what the shared usher account did and when, so admins
-- can audit door activity even though the login is shared.
-- ============================================================

create table if not exists public.usher_activity_log (
  id uuid primary key default gen_random_uuid(),
  usher_id uuid references auth.users(id),
  action text not null check (action in ('login', 'check_in', 'new_registration')),
  registrant_id uuid references public.registrants(id) on delete set null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table public.usher_activity_log enable row level security;

create index if not exists usher_activity_created_at_idx on public.usher_activity_log (created_at);

create policy "Admins can view usher activity"
  on public.usher_activity_log for select
  using (public.is_admin());

create policy "Ushers can log their own activity"
  on public.usher_activity_log for insert
  with check (public.is_usher_or_admin());
