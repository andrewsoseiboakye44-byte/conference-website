-- ============================================================
-- Migration 013: sms_gateway_and_audit_fixes
-- 1. Expands provider check constraint on sms_gateway_settings to include
--    popular Ghana/Africa gateways (Arkesel, Hubtel, mNotify).
-- 2. Expands campaign_type check constraint on sms_logs to include 'test_sms'.
-- 3. Grants ushers permission to record walk-in entries in invitations table.
-- ============================================================

-- 1. sms_gateway_settings provider check constraint
alter table public.sms_gateway_settings 
  drop constraint if exists sms_gateway_settings_provider_check;

alter table public.sms_gateway_settings 
  add constraint sms_gateway_settings_provider_check 
  check (provider in ('africastalking', 'twilio', 'vonage', 'arkesel', 'hubtel', 'mnotify', 'custom'));

-- 2. sms_logs campaign_type check constraint
alter table public.sms_logs 
  drop constraint if exists sms_logs_campaign_type_check;

alter table public.sms_logs 
  add constraint sms_logs_campaign_type_check 
  check (campaign_type in (
    'auto_confirmation',
    'pre_event_reminder',
    'livestream_alert',
    'post_event_thank_you',
    'invite_contacts',
    'test_sms'
  ));

-- 3. Allow ushers to insert walk-in contacts into invitations table
drop policy if exists "Ushers can record walk-in contacts" on public.invitations;
create policy "Ushers can record walk-in contacts"
  on public.invitations for insert
  with check (public.is_usher_or_admin());
