// ============================================================
// Netlify Serverless Function: create-usher.js
// Enables secure server-side usher account creation on Netlify.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rhdqrocagrkogbztwpmg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_rmQ97GXrUaGcsGIIFrdUeg_zj_5gfeI';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Method Not Allowed' }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON payload' }),
    };
  }

  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!username || !password || password.length < 6) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Username and minimum 6-character password are required.' }),
    };
  }

  const cleanUsername = username.replace(/[^a-z0-9_.-]/g, '');
  const email = `${cleanUsername}@usher.local`;

  // If service role key is configured in Netlify, use admin API
  if (SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          email,
          password,
          email_confirm: true,
          user_metadata: { role: 'usher', username: cleanUsername },
        }),
      });

      const json = await res.json().catch(() => null);
      if (res.ok && json?.id) {
        // Insert profiles record
        await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify({
            id: json.id,
            role: 'usher',
            username: cleanUsername,
            is_active: true,
          }),
        });

        return {
          statusCode: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: true, user: json }),
        };
      }
    } catch (adminErr) {
      console.warn('Admin create user error, falling back to signup:', adminErr);
    }
  }

  // Fallback: use standard auth signup endpoint
  try {
    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await signupRes.json().catch(() => null);
    if (signupRes.ok && (data?.id || data?.user?.id)) {
      return {
        statusCode: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, user: data }),
      };
    }

    return {
      statusCode: signupRes.status || 400,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: data?.msg || data?.error_description || 'Signup failed' }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Server error' }),
    };
  }
};
