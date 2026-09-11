-- ============================================================
-- Migration 007: sms_logs
-- Full audit trail of every SMS sent by the system, across all
-- five campaign types.
-- ============================================================

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
  provider text,               -- 'africastalking' | 'twilio' | 'vonage' | 'custom'
  provider_message_id text,
  cost numeric(10, 4),
  error_message text,

  sent_by uuid references auth.users(id),  -- null for system/auto sends
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

-- Edge Functions use the service_role key (bypasses RLS entirely),
-- so no separate insert policy is needed for the auto-confirmation SMS.
