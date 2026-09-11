-- ============================================================
-- Migration 010: Add schedule JSONB column to conference_settings
-- Stores multi-day, multi-session conference program schedule.
-- ============================================================

alter table public.conference_settings 
add column if not exists schedule jsonb default '[]'::jsonb;
