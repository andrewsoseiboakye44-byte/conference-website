// ============================================================
// Serverless Function: api/create-usher.js
// Compatible with Vercel Serverless Functions and Netlify
// Enables secure server-side usher account creation without CORS.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rhdqrocagrkogbztwpmg.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_rmQ97GXrUaGcsGIIFrdUeg_zj_5gfeI';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function processCreateUsher(body) {
  const username = String(body?.username || '').trim().toLowerCase();
  const password = String(body?.password || '');

  if (!username || !password || password.length < 6) {
    return {
      status: 400,
      data: { error: 'Username and minimum 6-character password are required.' },
    };
  }

  const cleanUsername = username.replace(/[^a-z0-9_.-]/g, '');
  const email = `${cleanUsername}@usher.local`;

  // 1. If service role key is configured, use admin API
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

        return { status: 200, data: { ok: true, user: json } };
      }
    } catch (adminErr) {
      console.warn('Admin create user error, falling back to signup:', adminErr);
    }
  }

  // 2. Fallback: standard signup using anon key
  try {
    const signupRes = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        email,
        password,
        data: { role: 'usher', username: cleanUsername },
      }),
    });

    const signupJson = await signupRes.json().catch(() => null);
    if (!signupRes.ok) {
      return {
        status: signupRes.status || 400,
        data: { error: signupJson?.msg || signupJson?.error_description || signupJson?.message || 'Failed to create user' },
      };
    }

    const userId = signupJson?.user?.id || signupJson?.id;
    if (userId) {
      await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify({
          id: userId,
          role: 'usher',
          username: cleanUsername,
          is_active: true,
        }),
      }).catch(() => {});
    }

    return { status: 200, data: { ok: true, user: signupJson?.user || signupJson } };
  } catch (err) {
    return { status: 500, data: { error: err.message || 'Server error creating usher' } };
  }
}

// Vercel Serverless Function entry point
module.exports = async function handler(req, res) {
  // Netlify event fallback check
  if (req && req.httpMethod && typeof res !== 'object' && !res?.status) {
    return netlifyHandler(req);
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
  }

  const result = await processCreateUsher(body);
  return res.status(result.status).json(result.data);
};

// Netlify Functions compatibility
async function netlifyHandler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS_HEADERS, body: 'OK' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers: CORS_HEADERS, body: JSON.stringify({ error: 'Invalid JSON payload' }) };
  }
  const result = await processCreateUsher(body);
  return {
    statusCode: result.status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify(result.data),
  };
}

module.exports.handler = netlifyHandler;
