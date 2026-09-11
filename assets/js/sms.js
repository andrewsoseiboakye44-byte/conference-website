// ============================================================
// sms.js — Universal SMS Gateway Engine & Dispatcher.
// Supports Africa's Talking, Hubtel, Arkesel, mNotify, Twilio,
// and any Custom Gateway HTTP API directly with Edge Function
// fallback and comprehensive sms_logs auditing.
// ============================================================

import { supabase } from './config.js';
import { formatPhoneNumber } from './utils.js';

const GATEWAY_LOCAL_STORAGE_KEY = 'conf_active_sms_gateway_v1';

/**
 * Retrieves the currently active SMS gateway settings.
 * Reads from Supabase sms_gateway_settings with local fallback cache.
 */
export async function getActiveGateway() {
  try {
    const { data, error } = await supabase
      .from('sms_gateway_settings')
      .select('*')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      // Check if local storage has key/secret override if encrypted
      const cached = getLocalGatewayConfig();
      if (cached && cached.provider === data.provider) {
        return {
          ...data,
          api_key: cached.api_key || data.api_key_encrypted,
          api_secret: cached.api_secret || data.api_secret_encrypted,
          endpoint_url: cached.endpoint_url || null,
        };
      }
      return {
        ...data,
        api_key: data.api_key_encrypted,
        api_secret: data.api_secret_encrypted,
      };
    }
  } catch (err) {
    console.warn('Could not query sms_gateway_settings from Supabase, checking local cache:', err);
  }

  return getLocalGatewayConfig();
}

/**
 * Saves active gateway configuration locally and in database
 */
export function saveLocalGatewayConfig(config) {
  try {
    localStorage.setItem(GATEWAY_LOCAL_STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.warn('Failed to save gateway to localStorage:', e);
  }
}

export function getLocalGatewayConfig() {
  try {
    const raw = localStorage.getItem(GATEWAY_LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Universal SMS Dispatcher.
 * Directly communicates with Africa's Talking, Arkesel, Hubtel,
 * mNotify, Twilio, or any custom REST/HTTP endpoint.
 */
export async function dispatchDirectSms({ phone, message, gateway = null, campaignType = 'manual_send' }) {
  const gw = gateway || await getActiveGateway();
  if (!gw || !gw.api_key) {
    return {
      status: 'failed',
      errorMessage: 'No active SMS gateway configured. Please configure your API key and Sender ID in SMS Gateway settings.',
    };
  }

  const normalizedPhone = formatPhoneNumber(phone);
  const senderId = gw.sender_id || 'CONFERENCE';
  const apiKey = gw.api_key;
  const apiSecret = gw.api_secret || '';
  const provider = gw.provider || 'custom';

  let status = 'sent';
  let errorMessage = null;

  try {
    if (provider === 'arkesel') {
      // Arkesel SMS API (Ghana: v2 SMS API)
      const url = `https://sms.arkesel.com/api/v2/sms/send`;
      const res = await fetch(url, {
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
      const data = await res.json().catch(() => null);
      if (!res.ok || (data && data.status && data.status !== 'success')) {
        throw new Error(data?.message || `Arkesel dispatch failed with HTTP ${res.status}`);
      }
    } else if (provider === 'hubtel') {
      // Hubtel SMS API
      const authHeader = btoa(`${apiKey}:${apiSecret}`);
      const params = new URLSearchParams({
        From: senderId,
        To: normalizedPhone,
        Content: message,
        ClientId: apiKey,
        ClientSecret: apiSecret,
      });
      const url = `https://smsc.hubtel.com/v1/messages/send?${params.toString()}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Basic ${authHeader}`,
        },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Hubtel dispatch failed (${res.status}): ${text}`);
      }
    } else if (provider === 'mnotify') {
      // mNotify SMS API (Ghana)
      const res = await fetch(`https://api.mnotify.com/api/sms/quick`, {
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
        throw new Error(json?.message || `mNotify send failed with status ${res.status}`);
      }
    } else if (provider === 'africastalking') {
      // Africa's Talking
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: {
          apiKey,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          username: apiSecret || 'sandbox',
          to: `+${normalizedPhone}`,
          message,
          from: senderId,
        }),
      });
      const json = await res.json().catch(() => null);
      const recipient = json?.SMSMessageData?.Recipients?.[0];
      if (!res.ok || (recipient && recipient.status !== 'Success')) {
        throw new Error(recipient?.status ?? json?.SMSMessageData?.Message ?? `Africa's Talking send failed (${res.status})`);
      }
    } else if (provider === 'twilio') {
      // Twilio SMS
      const accountSid = apiSecret;
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${accountSid}:${apiKey}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: `+${normalizedPhone}`,
          From: senderId,
          Body: message,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Twilio dispatch failed (${res.status}): ${text}`);
      }
    } else {
      // Custom Gateway / Universal HTTP API
      const endpoint = gw.endpoint_url || `https://api.smsghana.com/v1/sms/send`;
      let finalUrl = endpoint
        .replace(/\{API_KEY\}/g, encodeURIComponent(apiKey))
        .replace(/\{SENDER_ID\}/g, encodeURIComponent(senderId))
        .replace(/\{TO\}/g, encodeURIComponent(normalizedPhone))
        .replace(/\{MESSAGE\}/g, encodeURIComponent(message));

      // If URL didn't have placeholders, attach standard query params
      if (!finalUrl.includes(encodeURIComponent(normalizedPhone))) {
        const sep = finalUrl.includes('?') ? '&' : '?';
        finalUrl += `${sep}key=${encodeURIComponent(apiKey)}&sender=${encodeURIComponent(senderId)}&to=${encodeURIComponent(normalizedPhone)}&message=${encodeURIComponent(message)}`;
      }

      const res = await fetch(finalUrl, { method: 'GET' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Custom Gateway failed (${res.status}): ${text}`);
      }
    }
  } catch (err) {
    status = 'failed';
    errorMessage = String(err.message || err);
  }

  // Audit log into Supabase sms_logs table
  try {
    const { data: userRes } = await supabase.auth.getUser();
    const payload = {
      recipient_phone: normalizedPhone,
      message,
      campaign_type: campaignType,
      status,
      provider: provider,
      error_message: errorMessage,
      sent_by: userRes?.user?.id || null,
      sent_at: new Date().toISOString(),
    };

    const { error: logErr } = await supabase.from('sms_logs').insert(payload);
    if (logErr && (logErr.message?.includes('campaign_type') || logErr.code === '23514')) {
      // Fallback for unmigrated database constraint
      payload.campaign_type = 'invite_contacts';
      await supabase.from('sms_logs').insert(payload);
    }
  } catch (logErr) {
    console.warn('Could not write log to public.sms_logs:', logErr);
  }

  return { status, errorMessage };
}

/**
 * Triggers a campaign send. Tries Edge Function first, and falls
 * back to direct client-side provider dispatch if Edge Function is
 * unavailable or not deployed.
 */
export async function sendCampaign(campaignType, extra = {}) {
  // 1. Try Edge Function
  try {
    const res = await supabase.functions.invoke('send-bulk-sms', {
      body: { campaign_type: campaignType, ...extra },
    });
    if (!res.error && res.data) {
      return res;
    }
    console.warn('Edge Function returned error, using direct gateway fallback:', res.error);
  } catch (err) {
    console.warn('Edge Function unreachable, invoking direct gateway fallback:', err);
  }

  // 2. Client-side fallback dispatch to all targeted contacts
  const gw = await getActiveGateway();
  if (!gw || !gw.api_key) {
    return {
      error: { message: 'No active SMS Gateway configured. Please save your API Key in SMS Gateway settings.' },
    };
  }

  const message = extra.message || 'Conference notification from your church.';
  const targetAudience = extra.target_audience || 'registrants';

  let recipients = [];
  try {
    if (targetAudience === 'all_saved_and_registered') {
      const [{ data: regs }, { data: invs }] = await Promise.all([
        supabase.from('registrants').select('contact_phone'),
        supabase.from('invitations').select('contact_phone'),
      ]);
      const set = new Set();
      (regs || []).forEach((r) => r.contact_phone && set.add(r.contact_phone.trim()));
      (invs || []).forEach((i) => i.contact_phone && set.add(i.contact_phone.trim()));
      recipients = Array.from(set);
    } else {
      const { data: regs } = await supabase.from('registrants').select('contact_phone');
      recipients = (regs || []).map((r) => r.contact_phone).filter(Boolean);
    }
  } catch (fetchErr) {
    console.error('Error fetching recipient contacts for broadcast:', fetchErr);
    return { error: fetchErr };
  }

  let sent = 0;
  for (const phone of recipients) {
    const result = await dispatchDirectSms({
      phone,
      message,
      gateway: gw,
      campaignType,
    });
    if (result.status === 'sent') sent++;
  }

  return { data: { sent, total: recipients.length }, error: null };
}

/** Sends a one-off test SMS to verify the active gateway's credentials. */
export async function sendTestSms(phone) {
  // 1. Try Edge Function test-sms
  try {
    const res = await supabase.functions.invoke('test-sms', { body: { phone } });
    if (!res.error && res.data) {
      return res;
    }
  } catch {
    // proceed to direct fallback
  }

  // 2. Direct dispatch fallback
  const gw = await getActiveGateway();
  if (!gw || !gw.api_key) {
    return { error: { message: 'No active gateway configured. Please save your API Key first.' } };
  }

  const res = await dispatchDirectSms({
    phone,
    message: `Test SMS from ${gw.sender_id || 'Conference Gateway'}! Your gateway is active and configured properly.`,
    gateway: gw,
    campaignType: 'test_sms',
  });

  if (res.status === 'failed') {
    return { error: { message: res.errorMessage || 'Failed to dispatch test SMS' } };
  }

  return { data: { ok: true }, error: null };
}

export async function fetchSmsLogs(limit = 60) {
  return supabase
    .from('sms_logs')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(limit);
}

