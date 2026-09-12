import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Decrypts a value encrypted by save-gateway-settings/index.ts
 * (AES-GCM, same ENCRYPTION_KEY secret). Returns '' if empty/null.
 */
export async function decrypt(ciphertextB64: string | null): Promise<string> {
  if (!ciphertextB64) return '';
  const encKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encKey) return ciphertextB64; // Fallback: unencrypted plaintext

  try {
    const raw = Uint8Array.from(atob(encKey), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);

    const combined = Uint8Array.from(atob(ciphertextB64), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plaintext);
  } catch {
    // If decryption fails (e.g. key was stored plaintext), return as-is
    return ciphertextB64;
  }
}

/**
 * Admin client using the service_role key. This BYPASSES Row Level
 * Security entirely — only ever use inside Edge Functions, never
 * expose SUPABASE_SERVICE_ROLE_KEY to the frontend.
 *
 * Set these as Edge Function secrets:
 *   supabase secrets set SUPABASE_URL=...
 *   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
 */
export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

/**
 * Verifies the caller is an authenticated admin. Pass the request's
 * Authorization header through; throws if the user isn't an admin.
 */
export async function requireAdmin(req: Request) {
  const admin = getAdminClient();
  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace('Bearer ', '');

  const { data: { user }, error } = await admin.auth.getUser(jwt);
  if (error || !user) throw new Error('Not authenticated');

  const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') throw new Error('Admin access required');

  return { admin, user };
}

/**
 * Sends one SMS through whichever provider is currently active in
 * sms_gateway_settings, and logs the attempt to sms_logs.
 * Fill in the fetch() calls for the provider(s) you actually use —
 * the shapes below match each provider's typical REST API.
 */
export async function sendSms(admin: ReturnType<typeof getAdminClient>, {
  phone, message, campaignType, sentBy,
}: { phone: string; message: string; campaignType: string; sentBy: string | null }) {
  const { data: gateway } = await admin
    .from('sms_gateway_settings')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .single();

  if (!gateway) throw new Error('No active SMS gateway configured');

  const apiKey = await decrypt(gateway.api_key_encrypted);
  const apiSecret = await decrypt(gateway.api_secret_encrypted); // "username" for Africa's Talking

  let status = 'sent';
  let errorMessage: string | null = null;

  try {
    if (gateway.provider === 'africastalking') {
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          username: apiSecret,
          to: `+${phone}`,
          message,
          from: gateway.sender_id ?? '',
        }),
      });
      const json = await res.json();
      const recipient = json?.SMSMessageData?.Recipients?.[0];
      if (!res.ok || !recipient || recipient.status !== 'Success') {
        throw new Error(recipient?.status ?? json?.SMSMessageData?.Message ?? 'Africa\'s Talking send failed');
      }
    } else if (gateway.provider === 'arkesel') {
      const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: gateway.sender_id ?? 'CONFERENCE',
          message,
          recipients: [phone],
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || (json && json.status && json.status !== 'success')) {
        throw new Error(json?.message ?? `Arkesel send failed (${res.status})`);
      }
    } else if (gateway.provider === 'hubtel') {
      const authHeader = btoa(`${apiKey}:${apiSecret}`);
      const params = new URLSearchParams({
        From: gateway.sender_id ?? 'CONFERENCE',
        To: phone,
        Content: message,
        ClientId: apiKey,
        ClientSecret: apiSecret,
      });
      const res = await fetch(`https://smsc.hubtel.com/v1/messages/send?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Basic ${authHeader}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Hubtel send failed (${res.status}): ${text}`);
      }
    } else if (gateway.provider === 'mnotify') {
      const res = await fetch('https://api.mnotify.com/api/sms/quick', {
        method: 'POST',
        headers: {
          'key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: [phone],
          sender: gateway.sender_id ?? 'CONFERENCE',
          message,
          is_schedule: false,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || (json && json.status === 'error')) {
        throw new Error(json?.message ?? `mNotify send failed (${res.status})`);
      }
    } else if (gateway.provider === 'vonage') {
      const res = await fetch('https://rest.nexmo.com/sms/json', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          api_secret: apiSecret,
          to: phone,
          from: gateway.sender_id ?? 'CONFERENCE',
          text: message,
        }),
      });
      const json = await res.json().catch(() => null);
      const msgStatus = json?.messages?.[0]?.status;
      if (!res.ok || msgStatus !== '0') {
        throw new Error(json?.messages?.[0]?.['error-text'] ?? `Vonage send failed (${res.status})`);
      }
    } else if (gateway.provider === 'twilio') {
      // Twilio expects the "username" field to double as the Account SID.
      const accountSid = apiSecret;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${apiKey}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: `+${phone}`, From: gateway.sender_id ?? '', Body: message }),
      });
      if (!res.ok) throw new Error(`Twilio send failed (${res.status})`);
    } else {
      // Custom Gateway / Universal HTTP API
      const endpoint = gateway.endpoint_url || 'https://api.smsghana.com/v1/sms/send';
      let finalUrl = endpoint
        .replace(/\{API_KEY\}/g, encodeURIComponent(apiKey))
        .replace(/\{SENDER_ID\}/g, encodeURIComponent(gateway.sender_id ?? 'CONFERENCE'))
        .replace(/\{TO\}/g, encodeURIComponent(phone))
        .replace(/\{MESSAGE\}/g, encodeURIComponent(message));

      if (!finalUrl.includes(encodeURIComponent(phone))) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl += `${sep}key=${encodeURIComponent(apiKey)}&sender=${encodeURIComponent(gateway.sender_id ?? 'CONFERENCE')}&to=${encodeURIComponent(phone)}&message=${encodeURIComponent(message)}`;
      }

      const res = await fetch(finalUrl, { method: 'GET' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Custom SMS gateway send failed (${res.status}): ${text}`);
      }
    }
  } catch (err) {
    status = 'failed';
    errorMessage = String(err);
  }

  await admin.from('sms_logs').insert({
    recipient_phone: phone,
    message,
    campaign_type: campaignType,
    status,
    provider: gateway.provider,
    error_message: errorMessage,
    sent_by: sentBy,
  });

  return { status, errorMessage };
}
