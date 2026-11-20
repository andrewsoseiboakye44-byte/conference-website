-- ============================================================
-- Migration 013: momo_reference
-- Adds payment/giving reference field for Mobile Money donations.
-- ============================================================

alter table public.conference_settings 
  add column if not exists momo_reference text default 'DONATION';
