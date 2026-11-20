-- ============================================================
-- Migration 014: delete_registrant_policies
-- Allows administrative deletion of registrants and cascades to check-ins.
-- ============================================================

-- Allow admins to manage (select, insert, update, delete) check-ins
drop policy if exists "Admins can manage check-ins" on public.check_ins;
create policy "Admins can manage check-ins"
  on public.check_ins for all
  using (public.is_admin())
  with check (public.is_admin());

-- Ensure cascade deletion on check_ins foreign key
alter table public.check_ins
  drop constraint if exists check_ins_registrant_id_fkey,
  add constraint check_ins_registrant_id_fkey
  foreign key (registrant_id)
  references public.registrants(id)
  on delete cascade;
