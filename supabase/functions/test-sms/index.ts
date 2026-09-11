// ============================================================
// test-sms — sends a single test message using the currently
// active gateway, so the admin can verify credentials before
// relying on them for a real campaign.
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { requireAdmin, sendSms } from '../_shared/supabase-admin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { admin, user } = await requireAdmin(req);
    const { phone } = await req.json();

    const result = await sendSms(admin, {
      phone,
      message: 'This is a test message from your conference SMS gateway. If you received this, your credentials are working.',
      campaignType: 'auto_confirmation', // logged as a lightweight test; not shown to attendees
      sentBy: user.id,
    });

    if (result.status === 'failed') {
      return new Response(JSON.stringify({ error: result.errorMessage ?? 'Send failed' }), { status: 502, headers: corsHeaders });
    }

    // TODO: after a real provider call, also fetch and store the
    // provider's account balance into sms_gateway_settings.last_balance_check.

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
