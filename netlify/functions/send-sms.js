// ============================================================
// Netlify Serverless Function: send-sms.js
// Handles server-side SMS dispatching to eliminate browser CORS
// and guarantee reliable delivery across all SMS providers.
// Works seamlessly on Netlify without any Supabase CLI or Docker.
// ============================================================

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rhdqrocagrkogbztwpmg.supabase.co';
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
      body: JSON.stringify({ error: 'Method Not Allowed. Use POST.' }),
    };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Invalid JSON payload in request body.' }),
    };
  }

  const {
    phone,
    message,
    gateway,
    campaign_type = 'manual_send',
    action = 'send',
  } = body;

  if (!phone && action !== 'broadcast') {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({ error: 'Phone number is required.' }),
    };
  }

  // Resolve Gateway settings (either passed from client or fetched from Supabase)
  let gw = gateway;
  if (!gw || !gw.api_key) {
    gw = await fetchActiveGatewayFromSupabase();
  }

  if (!gw || !gw.api_key) {
    return {
      statusCode: 400,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        error: 'No active SMS Gateway credentials configured. Please enter and save your API Key in SMS Gateway Settings.',
      }),
    };
  }

  const finalMsg = message || (action === 'test'
    ? `Test SMS from ${gw.sender_id || 'Conference Gateway'}! Your gateway is active and working properly.`
    : 'Conference notification.');

  try {
    const dispatchResult = await dispatchToProvider({
      phone,
      message: finalMsg,
      gateway: gw,
    });

    // Log to Supabase sms_logs
    await logSmsAttempt({
      phone,
      message: finalMsg,
      provider: gw.provider || 'custom',
      status: dispatchResult.ok ? 'sent' : 'failed',
      errorMessage: dispatchResult.error || null,
      campaignType: action === 'test' ? 'test_sms' : campaign_type,
    });

    if (!dispatchResult.ok) {
      return {
        statusCode: 422,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: dispatchResult.error,
          provider: gw.provider,
          details: dispatchResult.details || null,
        }),
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        status: 'sent',
        provider: gw.provider,
        response: dispatchResult.data || null,
      }),
    };
  } catch (err) {
    const errorText = err.message || String(err);
    await logSmsAttempt({
      phone,
      message: finalMsg,
      provider: gw.provider || 'custom',
      status: 'failed',
      errorMessage: errorText,
      campaignType: action === 'test' ? 'test_sms' : campaign_type,
    });

    return {
      statusCode: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: errorText, provider: gw.provider }),
    };
  }
};

/**
 * Normalizes phone number to international / local provider digits
 */
function normalizePhone(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  let digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    return digits;
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = '233' + digits.slice(1);
  } else if (!digits.startsWith('233') && digits.length <= 10) {
    digits = '233' + digits;
  }
  return digits;
}

/**
 * Dispatches the SMS directly from the server to the provider
 */
async function dispatchToProvider({ phone, message, gateway }) {
  const provider = (gateway.provider || 'custom').toLowerCase();
  const apiKey = (gateway.api_key || '').trim();
  const apiSecret = (gateway.api_secret || '').trim();
  const senderId = (gateway.sender_id || 'CONFERENCE').trim();
  const normalizedPhone = normalizePhone(phone);

  if (provider === 'arkesel') {
    // Arkesel SMS API v2 (Ghana)
    // Primary endpoint: v2 JSON API
    const res = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: senderId,
        message: message,
        recipients: [normalizedPhone],
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || (json && json.status === 'error')) {
      const errMsg = json?.message || `Arkesel dispatch failed with HTTP ${res.status}`;
      return { ok: false, error: errMsg, details: json };
    }
    return { ok: true, data: json };
  }

  if (provider === 'mnotify') {
    // mNotify SMS API (Ghana)
    const res = await fetch('https://api.mnotify.com/api/sms/quick', {
      method: 'POST',
      headers: {
        'key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: [normalizedPhone],
        sender: senderId,
        message: message,
        is_schedule: false,
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || (json && json.status === 'error')) {
      const errMsg = json?.message || `mNotify send failed with status ${res.status}`;
      return { ok: false, error: errMsg, details: json };
    }
    return { ok: true, data: json };
  }

  if (provider === 'hubtel') {
    // Hubtel SMS API (Ghana)
    const authHeader = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    const params = new URLSearchParams({
      From: senderId,
      To: normalizedPhone,
      Content: message,
      ClientId: apiKey,
      ClientSecret: apiSecret,
    });
    const res = await fetch(`https://smsc.hubtel.com/v1/messages/send?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${authHeader}`,
      },
    });

    const text = await res.text().catch(() => '');
    let json = null;
    try { json = JSON.parse(text); } catch {}

    if (!res.ok) {
      const errMsg = json?.message || text || `Hubtel send failed with HTTP ${res.status}`;
      return { ok: false, error: errMsg, details: json || text };
    }
    return { ok: true, data: json || text };
  }

  if (provider === 'africastalking') {
    // Africa's Talking SMS API
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey: apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        username: apiSecret || 'sandbox',
        to: `+${normalizedPhone}`,
        message: message,
        from: senderId,
      }),
    });

    const json = await res.json().catch(() => null);
    const recipient = json?.SMSMessageData?.Recipients?.[0];
    if (!res.ok || (recipient && recipient.status !== 'Success')) {
      const errMsg = recipient?.status || json?.SMSMessageData?.Message || `Africa's Talking send failed (${res.status})`;
      return { ok: false, error: errMsg, details: json };
    }
    return { ok: true, data: json };
  }

  if (provider === 'twilio') {
    // Twilio SMS
    const accountSid = apiSecret;
    const authHeader = Buffer.from(`${accountSid}:${apiKey}`).toString('base64');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: `+${normalizedPhone}`,
        From: senderId,
        Body: message,
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const errMsg = json?.message || `Twilio send failed (${res.status})`;
      return { ok: false, error: errMsg, details: json };
    }
    return { ok: true, data: json };
  }

  if (provider === 'vonage') {
    // Vonage / Nexmo SMS API
    const res = await fetch('https://rest.nexmo.com/sms/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        api_secret: apiSecret,
        to: normalizedPhone,
        from: senderId,
        text: message,
      }),
    });

    const json = await res.json().catch(() => null);
    const msgStatus = json?.messages?.[0]?.status;
    if (!res.ok || msgStatus !== '0') {
      const errMsg = json?.messages?.[0]?.['error-text'] || `Vonage send failed (${res.status})`;
      return { ok: false, error: errMsg, details: json };
    }
    return { ok: true, data: json };
  }

  // Custom Gateway / Universal HTTP API
  const endpoint = gateway.endpoint_url || 'https://api.smsghana.com/v1/sms/send';
  let finalUrl = endpoint
    .replace(/\{API_KEY\}/g, encodeURIComponent(apiKey))
    .replace(/\{SENDER_ID\}/g, encodeURIComponent(senderId))
    .replace(/\{TO\}/g, encodeURIComponent(normalizedPhone))
    .replace(/\{MESSAGE\}/g, encodeURIComponent(message));

  if (!finalUrl.includes(encodeURIComponent(normalizedPhone))) {
    const sep = finalUrl.includes('?') ? '&' : '?';
    finalUrl += `${sep}key=${encodeURIComponent(apiKey)}&sender=${encodeURIComponent(senderId)}&to=${encodeURIComponent(normalizedPhone)}&message=${encodeURIComponent(message)}`;
  }

  const res = await fetch(finalUrl, { method: 'GET' });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, error: `Custom Gateway failed with HTTP ${res.status}: ${text}` };
  }
  return { ok: true, data: text };
}

/**
 * Fallback to read active gateway directly from Supabase REST API
 */
async function fetchActiveGatewayFromSupabase() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/sms_gateway_settings?is_active=eq.true&limit=1`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const item = list[0];
        return {
          provider: item.provider,
          sender_id: item.sender_id,
          api_key: item.api_key_encrypted,
          api_secret: item.api_secret_encrypted,
          endpoint_url: item.endpoint_url || null,
        };
      }
    }
  } catch (err) {
    console.warn('Could not query Supabase for gateway settings in Netlify function:', err);
  }
  return null;
}

/**
 * Log dispatch outcome to sms_logs table in Supabase
 */
async function logSmsAttempt({ phone, message, provider, status, errorMessage, campaignType }) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/sms_logs`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        recipient_phone: phone,
        message: message,
        campaign_type: campaignType,
        status: status,
        provider: provider,
        error_message: errorMessage,
        sent_at: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.warn('Could not write sms_log in Netlify function:', err);
  }
}
