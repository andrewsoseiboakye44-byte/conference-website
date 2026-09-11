-- ============================================================
-- Optional seed data — sample speakers so the public page isn't
-- empty while you're testing. Safe to skip or delete.
-- Run with: supabase db execute -f supabase/seeds/sample_speakers.sql
-- ============================================================

insert into public.speakers (name, title, bio, display_order)
values
  ('Rev. Samuel Owusu', 'Senior Pastor', 'Leading the congregation for over 15 years with a heart for discipleship and community outreach.', 1),
  ('Pastor Grace Mensah', 'Youth & Missions Director', 'Passionate about raising the next generation of leaders across West Africa.', 2)
on conflict do nothing;
