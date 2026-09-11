-- ============================================================
-- Migration 003: speakers
-- ============================================================

create table if not exists public.speakers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text,
  bio text,
  photo_url text,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.speakers enable row level security;

create policy "Anyone can read speakers"
  on public.speakers for select
  using (true);

create policy "Admins can manage speakers"
  on public.speakers for all
  using (public.is_admin())
  with check (public.is_admin());

create index if not exists speakers_display_order_idx on public.speakers (display_order);
