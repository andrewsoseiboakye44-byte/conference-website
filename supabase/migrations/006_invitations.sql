-- ============================================================
-- Migration 006: invitations
-- Tracks contacts uploaded for bulk SMS invitations, and whether
-- they later registered (for conversion-rate reporting).
-- ============================================================

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  contact_name text,
  contact_phone text not null,

  batch_label text,               -- e.g. "September Invite Batch 1"
  sms_sent boolean not null default false,
  sms_sent_at timestamptz,

  -- Set once we detect a matching registrant (by phone number)
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

-- Automatically link and mark invitations converted when matching phone registers
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
