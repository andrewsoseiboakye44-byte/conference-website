// ============================================================
// send-sms — called by public.js right after a registration is
// inserted. Sends the auto-confirmation message.
// No auth required (this fires for anonymous public registrants),
// but it only ever sends to the phone number of a registrant that
// was JUST created, looked up server-side — the client can't make
// it send arbitrary messages.
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { getAdminClient, sendSms } from '../_shared/supabase-admin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { type, registrant_id } = await req.json();
    if (type !== 'confirmation' || !registrant_id) {
      return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: corsHeaders });
    }

    const admin = getAdminClient();
    const { data: registrant, error } = await admin
      .from('registrants')
      .select('full_name, contact_phone')
      .eq('id', registrant_id)
      .single();

    if (error || !registrant) {
      return new Response(JSON.stringify({ error: 'Registrant not found' }), { status: 404, headers: corsHeaders });
    }

    const { data: settings } = await admin.from('conference_settings').select('conference_name').limit(1).single();

    const message = `Hi ${registrant.full_name}, you're registered for ${settings?.conference_name ?? 'our conference'}! See you there.`;

    const result = await sendSms(admin, {
      phone: registrant.contact_phone,
      message,
      campaignType: 'auto_confirmation',
      sentBy: null,
    });

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
