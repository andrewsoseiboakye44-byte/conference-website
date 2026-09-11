// ============================================================
// reset-usher-password — admin-only. Resets a usher's auth
// password without needing their old one.
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/supabase-admin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { admin } = await requireAdmin(req);
    const { user_id, password } = await req.json();

    if (!user_id || !password || password.length < 6) {
      return new Response(JSON.stringify({ error: 'user_id and a 6+ character password are required' }), { status: 400, headers: corsHeaders });
    }

    const { error } = await admin.auth.admin.updateUserById(user_id, { password });
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
