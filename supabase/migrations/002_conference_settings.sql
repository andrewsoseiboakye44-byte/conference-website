-- ============================================================
-- Migration 002: conference_settings
-- Single-row (or versioned) table driving the public page CMS content.
-- ============================================================

create table if not exists public.conference_settings (
  id uuid primary key default gen_random_uuid(),
  conference_name text not null default 'Annual Conference',
  theme_scripture text,
  venue text,
  start_date date,
  end_date date,
  daily_time text,
  description text,
  flyer_image_url text,
  facebook_live_url text,
  youtube_live_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.conference_settings enable row level security;

-- Public (anonymous) visitors can read settings — drives the
-- hero/about sections of the registration page.
create policy "Anyone can read conference settings"
  on public.conference_settings for select
  using (true);

create policy "Admins can manage conference settings"
  on public.conference_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- Seed a single default row so the app always has something to render.
insert into public.conference_settings (conference_name, theme_scripture, venue, description)
values (
  'Annual Conference',
  'Set your theme/scripture here',
  'Set your venue here',
  'Edit this description from the Admin Dashboard → Manage Conference Info.'
)
on conflict do nothing;
