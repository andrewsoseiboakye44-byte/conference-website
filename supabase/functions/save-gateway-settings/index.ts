// ============================================================
// save-gateway-settings — encrypts the API key/secret before
// storing them, and marks this provider as the single active one.
//
// Encryption: AES-GCM using a key from the ENCRYPTION_KEY secret
// (32 random bytes, base64-encoded). Generate one with:
//   openssl rand -base64 32
// then: supabase secrets set ENCRYPTION_KEY=<value>
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/supabase-admin.ts';

async function getCryptoKey() {
  const raw = Uint8Array.from(atob(Deno.env.get('ENCRYPTION_KEY')!), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encrypt(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const key = await getCryptoKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { admin, user } = await requireAdmin(req);
    const { provider, sender_id, api_key, api_secret } = await req.json();

    if (!provider) {
      return new Response(JSON.stringify({ error: 'Provider is required' }), { status: 400, headers: corsHeaders });
    }

    // Only one gateway can be active at a time.
    await admin.from('sms_gateway_settings').update({ is_active: false }).eq('is_active', true);

    const payload: Record<string, unknown> = {
      provider,
      sender_id,
      is_active: true,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };
    if (api_key) payload.api_key_encrypted = await encrypt(api_key);
    if (api_secret) payload.api_secret_encrypted = await encrypt(api_secret);

    const { data: existing } = await admin.from('sms_gateway_settings').select('id').eq('provider', provider).limit(1).single();

    const { error } = existing
      ? await admin.from('sms_gateway_settings').update(payload).eq('id', existing.id)
      : await admin.from('sms_gateway_settings').insert(payload);

    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
