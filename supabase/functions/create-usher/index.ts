// ============================================================
// create-usher — admin-only. Creates a real Supabase Auth user
// under an internal "username@usher.local" email, plus a
// matching profiles row with role='usher'.
// ============================================================

import { corsHeaders } from '../_shared/cors.ts';
import { requireAdmin } from '../_shared/supabase-admin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { admin } = await requireAdmin(req);
    const { username, password } = await req.json();

    if (!username || !password || password.length < 6) {
      return new Response(JSON.stringify({ error: 'Username and a 6+ character password are required' }), { status: 400, headers: corsHeaders });
    }

    const email = `${username.trim().toLowerCase()}@usher.local`;

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createError) throw createError;

    const { error: profileError } = await admin.from('profiles').insert({
      id: created.user.id,
      role: 'usher',
      username: username.trim().toLowerCase(),
      is_active: true,
    });
    if (profileError) throw profileError;

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
