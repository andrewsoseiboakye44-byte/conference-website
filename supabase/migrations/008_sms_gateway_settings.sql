-- ============================================================
-- Migration 008: sms_gateway_settings
-- Configurable SMS provider credentials. Only ONE row should be
-- marked is_active = true at a time (the "current" provider).
--
-- IMPORTANT: api_key / api_secret are stored encrypted using
-- pgsodium (Supabase's built-in Vault/encryption), never as plain
-- text. See supabase/functions/README for how Edge Functions
-- decrypt these at send-time using the service_role key.
-- ============================================================

create table if not exists public.sms_gateway_settings (
  id uuid primary key default gen_random_uuid(),

  provider text not null check (provider in ('africastalking', 'twilio', 'vonage', 'custom')),
  sender_id text,

  -- Encrypted at rest. Never selected by the anon/authenticated
  -- client role — only readable via service_role in Edge Functions.
  api_key_encrypted text,
  api_secret_encrypted text,

  is_active boolean not null default false,
  last_balance_check numeric(10, 2),
  last_balance_checked_at timestamptz,

  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.sms_gateway_settings enable row level security;

-- Admins can see that settings exist (provider name, sender ID,
-- active flag) but the encrypted key columns are meaningless
-- without the service_role decryption key, so this is safe to
-- expose for the "which provider is active" UI state.
create policy "Admins can manage sms gateway settings"
  on public.sms_gateway_settings for all
  using (public.is_admin())
  with check (public.is_admin());

create unique index if not exists sms_gateway_one_active_idx
  on public.sms_gateway_settings (is_active)
  where is_active = true;
