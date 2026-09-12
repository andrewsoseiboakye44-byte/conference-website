// ============================================================
// sms.js — Universal SMS Gateway Engine & Dispatcher.
// Supports Africa's Talking, Hubtel, Arkesel, mNotify, Twilio,
// Vonage, and any Custom Gateway HTTP API.
// Eliminates browser CORS issues using serverless & server proxies
// with complete fallback and comprehensive audit logging.
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
      const cached = getLocalGatewayConfig();
      if (cached && cached.provider === data.provider) {
        return {
          ...data,
          api_key: cached.api_key || data.api_key_encrypted,
          api_secret: cached.api_secret || data.api_secret_encrypted,
          endpoint_url: cached.endpoint_url || data.endpoint_url || null,
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
 * Calls backend server proxy (Netlify Function or PHP proxy)
 * to execute SMS dispatch from server-side without CORS limitations.
 */
async function callServerProxy(payload) {
  let lastError = null;

  // 1. Try Netlify Functions endpoint (Production / Netlify CLI)
  try {
    const netlifyRes = await fetch('/.netlify/functions/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (netlifyRes.status !== 404) {
      const json = await netlifyRes.json().catch(() => null);
      if (!netlifyRes.ok || (json && json.ok === false)) {
        throw new Error(json?.error || `SMS gateway dispatch failed (HTTP ${netlifyRes.status})`);
      }
      return { ok: true, data: json };
    }
  } catch (err) {
    lastError = err;
    if (err.message && !err.message.includes('404') && !err.message.includes('Failed to fetch')) {
      throw err; // Real provider error returned by proxy
    }
  }

  // 2. Try PHP proxy (for local Apache / XAMPP environments)
  try {
    // Resolve relative path to root api/send-sms.php
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    // Find project folder name if in subfolder (e.g. /conference-website/)
    let phpUrl = '/api/send-sms.php';
    if (pathParts.length > 0 && !pathParts[0].includes('.')) {
      phpUrl = `/${pathParts[0]}/api/send-sms.php`;
    }

    const phpRes = await fetch(phpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (phpRes.status !== 404) {
      const json = await phpRes.json().catch(() => null);
      if (!phpRes.ok || (json && json.ok === false)) {
        throw new Error(json?.error || `Local SMS proxy failed (HTTP ${phpRes.status})`);
      }
      return { ok: true, data: json };
    }
  } catch (err) {
    lastError = err;
    if (err.message && !err.message.includes('404') && !err.message.includes('Failed to fetch')) {
      throw err;
    }
  }

  // 3. Try Supabase Edge Function test-sms / send-sms
  if (payload.action === 'test') {
    try {
      const fnRes = await supabase.functions.invoke('test-sms', { body: { phone: payload.phone } });
      if (!fnRes.error && fnRes.data) {
        return { ok: true, data: fnRes.data };
      }
      if (fnRes.error?.message) {
        lastError = new Error(fnRes.error.message);
      }
    } catch (e) {
      lastError = e;
    }
  }

  throw lastError || new Error('Unable to connect to SMS proxy. Please check your network and gateway configuration.');
}

/**
 * Universal SMS Dispatcher.
 * Dispatches via server-side proxies to prevent CORS blocks and ensure
 * instant delivery. Logs results to Supabase sms_logs table.
 */
export async function dispatchDirectSms({
  phone,
  message,
  gateway = null,
  campaignType = 'manual_send',
  action = 'send',
}) {
  const gw = gateway || await getActiveGateway();
  if (!gw || !gw.api_key) {
    return {
      status: 'failed',
      errorMessage: 'No active SMS gateway configured. Please save your API Key and Sender ID in SMS Gateway settings.',
    };
  }

  const normalizedPhone = formatPhoneNumber(phone);
  let status = 'sent';
  let errorMessage = null;

  try {
    await callServerProxy({
      action,
      phone: normalizedPhone,
      message,
      gateway: gw,
      campaign_type: campaignType,
    });
  } catch (err) {
    status = 'failed';
    errorMessage = err.message || String(err);
  }

  // Client-side audit log fallback into Supabase sms_logs table
  try {
    const { data: userRes } = await supabase.auth.getUser();
    await supabase.from('sms_logs').insert({
      recipient_phone: normalizedPhone,
      message,
      campaign_type: campaignType,
      status,
      provider: gw.provider || 'custom',
      error_message: errorMessage,
      sent_by: userRes?.user?.id || null,
      sent_at: new Date().toISOString(),
    });
  } catch (logErr) {
    console.warn('Could not write log to sms_logs:', logErr);
  }

  return { status, errorMessage };
}

/**
 * Sends a one-off test SMS to verify gateway credentials.
 * Supports passing a temporary gateway config directly (e.g. from unsaved form).
 */
export async function sendTestSms(phone, gatewayOverride = null) {
  const gw = gatewayOverride || await getActiveGateway();
  if (!gw || !gw.api_key) {
    return {
      error: { message: 'No active gateway configured. Please enter your API Key first.' },
    };
  }

  const res = await dispatchDirectSms({
    phone,
    message: `Test SMS from ${gw.sender_id || 'Conference Gateway'}! Your gateway credentials are functioning properly.`,
    gateway: gw,
    campaignType: 'test_sms',
    action: 'test',
  });

  if (res.status === 'failed') {
    return { error: { message: res.errorMessage || 'Failed to dispatch test SMS' } };
  }

  return { data: { ok: true }, error: null };
}

/**
 * Helper to dispatch registration confirmation SMS to newly registered attendee.
 */
export async function sendRegistrationConfirmationSms({ fullName, phone, registrantId = null }) {
  if (!phone) return { status: 'failed', errorMessage: 'No phone number provided' };

  // Fetch conference title from settings if available
  let confName = 'the Annual Conference';
  try {
    const { data } = await supabase.from('conference_settings').select('conference_name').limit(1).maybeSingle();
    if (data?.conference_name) confName = data.conference_name;
  } catch {}

  const msg = `Hi ${fullName || 'there'}, your registration for ${confName} is confirmed! We look forward to seeing you.`;

  return dispatchDirectSms({
    phone,
    message: msg,
    campaignType: 'auto_confirmation',
    action: 'send',
  });
}

/**
 * Triggers a campaign send to all targeted contacts with detailed progress.
 */
export async function sendCampaign(campaignType, extra = {}) {
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

  if (recipients.length === 0) {
    return {
      error: { message: 'No contacts found for this audience group. Please add registrants or invite contacts first.' },
    };
  }

  let sent = 0;
  let failed = 0;
  let lastError = null;

  for (const phone of recipients) {
    const result = await dispatchDirectSms({
      phone,
      message,
      gateway: gw,
      campaignType,
    });
    if (result.status === 'sent') {
      sent++;
    } else {
      failed++;
      lastError = result.errorMessage;
    }
  }

  if (sent === 0 && failed > 0) {
    return {
      error: { message: `All ${failed} messages failed to dispatch: ${lastError || 'Check provider credentials and balance.'}` },
    };
  }

  return { data: { sent, failed, total: recipients.length }, error: null };
}

export async function fetchSmsLogs(limit = 60) {
  return supabase
    .from('sms_logs')
    .select('*')
    .order('sent_at', { ascending: false })
    .limit(limit);
}
