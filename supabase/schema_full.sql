-- ============================================================
-- CHURCH CONFERENCE MANAGEMENT SYSTEM - FULL DATABASE SCHEMA
-- Paste this entire script into your Supabase SQL Editor and click "Run".
-- ============================================================

-- ------------------------------------------------------------
-- 1. PROFILES TABLE & ROLE HELPERS
-- ------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin', 'usher')),
  username text unique,
  full_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Helper: is current user an admin?
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

-- Helper: is current user an active usher or admin?
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

-- ------------------------------------------------------------
-- 2. CONFERENCE SETTINGS (CMS)
-- ------------------------------------------------------------
create table if not exists public.conference_settings (
  id uuid primary key default gen_random_uuid(),
  conference_name text not null default 'Annual Conference',
  theme_scripture text,
  venue text,
  start_date date,
  end_date date,
  daily_time text,
  schedule jsonb default '[]'::jsonb,
  description text,
  flyer_image_url text,
  facebook_live_url text,
  youtube_live_url text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.conference_settings enable row level security;

create policy "Anyone can read conference settings"
  on public.conference_settings for select
  using (true);

create policy "Admins can manage conference settings"
  on public.conference_settings for all
  using (public.is_admin())
  with check (public.is_admin());

-- Seed default settings
insert into public.conference_settings (conference_name, theme_scripture, venue, description)
values (
  'Annual Conference',
  'Set your theme/scripture here',
  'Set your venue here',
  'Edit this description from the Admin Dashboard → Manage Conference Info.'
)
on conflict do nothing;

-- ------------------------------------------------------------
-- 3. SPEAKERS
-- ------------------------------------------------------------
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

-- Sample speakers
insert into public.speakers (name, title, bio, display_order)
values
  ('Rev. Samuel Owusu', 'Senior Pastor', 'Leading the congregation for over 15 years with a heart for discipleship and community outreach.', 1),
  ('Pastor Grace Mensah', 'Youth & Missions Director', 'Passionate about raising the next generation of leaders across West Africa.', 2)
on conflict do nothing;

-- ------------------------------------------------------------
-- 4. REGISTRANTS
-- ------------------------------------------------------------
create table if not exists public.registrants (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('person', 'institution', 'church')),
  full_name text not null,
  location text,
  contact_phone text not null,
  invited_by text,
  church_affiliation text,
  is_first_time boolean default false,
  number_of_members integer,
  is_checked_in boolean not null default false,
  checked_in_at timestamptz,
  registered_via text not null default 'public' check (registered_via in ('public', 'admin', 'usher')),
  registered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.registrants enable row level security;

create index if not exists registrants_phone_idx on public.registrants (contact_phone);
create index if not exists registrants_category_idx on public.registrants (category);
create index if not exists registrants_checked_in_idx on public.registrants (is_checked_in);
create index if not exists registrants_created_at_idx on public.registrants (created_at);

create policy "Anyone can register"
  on public.registrants for insert
  with check (registered_via = 'public');

create policy "Public registrants can read recent registration"
  on public.registrants for select
  using (registered_via = 'public' and created_at >= now() - interval '60 seconds');

create policy "Admins can manage all registrants"
  on public.registrants for all
  using (public.is_admin())
  with check (public.is_admin());

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

-- ------------------------------------------------------------
-- 5. CHECK-INS
-- ------------------------------------------------------------
create table if not exists public.check_ins (
  id uuid primary key default gen_random_uuid(),
  registrant_id uuid references public.registrants(id) on delete cascade,
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

-- ------------------------------------------------------------
-- 6. INVITATIONS & AUTOMATIC CONVERSION TRIGGER
-- ------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  contact_name text,
  contact_phone text not null,
  batch_label text,
  sms_sent boolean not null default false,
  sms_sent_at timestamptz,
  converted boolean not null default false,
  registrant_id uuid references public.registrants(id) on delete set null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.invitations enable row level security;

create index if not exists invitations_phone_idx on public.invitations (contact_phone);
create index if not exists invitations_batch_idx on public.invitations (batch_label);

create policy "Admins can manage invitations"
  on public.invitations for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.handle_registrant_conversion()
returns trigger
language plpgsql
security definer
as $$
begin
  update public.invitations
  set converted = true,
      registrant_id = NEW.id
  where contact_phone = NEW.contact_phone
    and converted = false;
  return NEW;
end;
$$;

drop trigger if exists on_registrant_created_check_conversion on public.registrants;
create trigger on_registrant_created_check_conversion
  after insert on public.registrants
  for each row
  execute function public.handle_registrant_conversion();

-- ------------------------------------------------------------
-- 7. SMS LOGS
-- ------------------------------------------------------------
create table if not exists public.sms_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_phone text not null,
  message text not null,
  campaign_type text not null check (campaign_type in (
    'auto_confirmation',
    'pre_event_reminder',
    'livestream_alert',
    'post_event_thank_you',
    'invite_contacts'
  )),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  provider text,
  provider_message_id text,
  cost numeric(10, 4),
  error_message text,
  sent_by uuid references auth.users(id),
  sent_at timestamptz not null default now()
);

alter table public.sms_logs enable row level security;

create index if not exists sms_logs_campaign_idx on public.sms_logs (campaign_type);
create index if not exists sms_logs_sent_at_idx on public.sms_logs (sent_at);
create index if not exists sms_logs_status_idx on public.sms_logs (status);

create policy "Admins can manage sms logs"
  on public.sms_logs for all
  using (public.is_admin())
  with check (public.is_admin());

-- ------------------------------------------------------------
-- 8. SMS GATEWAY SETTINGS
-- ------------------------------------------------------------
create table if not exists public.sms_gateway_settings (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('africastalking', 'twilio', 'vonage', 'custom')),
  sender_id text,
  api_key_encrypted text,
  api_secret_encrypted text,
  is_active boolean not null default false,
  last_balance_check numeric(10, 2),
  last_balance_checked_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.sms_gateway_settings enable row level security;

create policy "Admins can manage sms gateway settings"
  on public.sms_gateway_settings for all
  using (public.is_admin())
  with check (public.is_admin());

create unique index if not exists sms_gateway_one_active_idx
  on public.sms_gateway_settings (is_active)
  where is_active = true;

-- ------------------------------------------------------------
-- 9. USHER ACTIVITY LOG
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 10. REALTIME PUBLICATIONS
-- ------------------------------------------------------------
-- Enable Realtime events for live dashboard and usher counters
alter publication supabase_realtime add table public.check_ins;
alter publication supabase_realtime add table public.registrants;

-- ------------------------------------------------------------
-- 11. STORAGE BUCKETS & POLICIES
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('conference-assets', 'conference-assets', true)
on conflict (id) do update set public = true;

drop policy if exists "Public Access to conference-assets" on storage.objects;
create policy "Public Access to conference-assets"
on storage.objects for select
using ( bucket_id = 'conference-assets' );

drop policy if exists "Authenticated users can upload conference-assets" on storage.objects;
create policy "Authenticated users can upload conference-assets"
on storage.objects for insert
to authenticated
with check ( bucket_id = 'conference-assets' );

drop policy if exists "Authenticated users can update conference-assets" on storage.objects;
create policy "Authenticated users can update conference-assets"
on storage.objects for update
to authenticated
using ( bucket_id = 'conference-assets' );

drop policy if exists "Authenticated users can delete conference-assets" on storage.objects;
create policy "Authenticated users can delete conference-assets"
on storage.objects for delete
to authenticated
using ( bucket_id = 'conference-assets' );
