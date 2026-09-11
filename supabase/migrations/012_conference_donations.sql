-- ============================================================
-- Migration 012: conference_donations
-- Adds optional Mobile Money (MoMo) donation & support fields to conference_settings.
-- ============================================================

alter table public.conference_settings 
  add column if not exists momo_number text,
  add column if not exists momo_account_name text,
  add column if not exists momo_network text default 'MTN',
  add column if not exists donation_title text default 'Partner & Support This Conference',
  add column if not exists donation_note text default 'Registration is 100% free. Voluntary donations support conference logistics, materials, and community outreach.';
