-- ============================================================
-- Migration 015: sms_gateway_public_dispatch
-- 1. Adds endpoint_url column if not present in sms_gateway_settings.
-- 2. Allows reading active SMS gateway settings for auto-confirmation
--    SMS dispatch (by public attendees registering via forwarded links,
--    QR codes, direct portal visits, and serverless proxy dispatch).
-- 3. Allows inserting into sms_logs for campaign_type = 'auto_confirmation'
--    so public registrations can record their dispatch audit trail.
-- 4. Adds an RPC function get_active_sms_gateway_for_dispatch() with
--    SECURITY DEFINER to reliably retrieve active gateway details.
-- ============================================================

-- 1. Ensure optional endpoint_url column exists
alter table public.sms_gateway_settings 
  add column if not exists endpoint_url text;

-- 2. Allow public reading of active gateway for dispatch
drop policy if exists "Allow reading active gateway for dispatch" on public.sms_gateway_settings;
create policy "Allow reading active gateway for dispatch"
  on public.sms_gateway_settings
  for select
  using (is_active = true);

-- 3. Allow recording auto-confirmation SMS logs
drop policy if exists "Allow recording auto_confirmation sms logs" on public.sms_logs;
create policy "Allow recording auto_confirmation sms logs"
  on public.sms_logs
  for insert
  with check (campaign_type = 'auto_confirmation');

-- 4. Security definer function for direct RPC dispatch
create or replace function public.get_active_sms_gateway_for_dispatch()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  gw record;
begin
  select provider, sender_id, api_key_encrypted, api_secret_encrypted, endpoint_url
  into gw
  from public.sms_gateway_settings
  where is_active = true
  limit 1;

  if not found then
    return null;
  end if;

  return json_build_object(
    'provider', coalesce(gw.provider, 'mnotify'),
    'sender_id', coalesce(gw.sender_id, 'GET-WISDOM'),
    'api_key', gw.api_key_encrypted,
    'api_secret', gw.api_secret_encrypted,
    'endpoint_url', gw.endpoint_url
  );
end;
$$;

grant execute on function public.get_active_sms_gateway_for_dispatch() to anon, authenticated, service_role;
