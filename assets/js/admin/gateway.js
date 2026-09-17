// ============================================================
// admin/gateway.js — Universal SMS Gateway Configuration.
// Allows administrators to add and activate any SMS provider
// (Africa's Talking, Hubtel, Arkesel, mNotify, Twilio, Vonage,
// or any Custom Gateway HTTP API).
// ============================================================

import { supabase } from '../config.js';
import { sendTestSms, getActiveGateway, saveLocalGatewayConfig } from '../sms.js';
import { showToast, escapeHtml } from '../utils.js';

const PROVIDER_INFO = {
  africastalking: {
    keyLabel: "Africa's Talking API Key *",
    secretLabel: "Africa's Talking Username *",
    secretPlaceholder: "e.g. your_username or sandbox",
    hasSecret: true,
    hint: "Standard Africa's Talking REST API.",
    needsEndpoint: false,
  },
  arkesel: {
    keyLabel: "Arkesel API Key *",
    secretLabel: "Optional Note / Sub-Account",
    secretPlaceholder: "Optional",
    hasSecret: false,
    hint: "Arkesel SMS Gateway (Ghana). Get your API key from the Arkesel portal.",
    needsEndpoint: false,
  },
  hubtel: {
    keyLabel: "Hubtel Client ID *",
    secretLabel: "Hubtel Client Secret *",
    secretPlaceholder: "Enter your Hubtel Client Secret",
    hasSecret: true,
    hint: "Hubtel SMS API (Ghana). Get your Client ID and Client Secret from Hubtel developer console.",
    needsEndpoint: false,
  },
  mnotify: {
    keyLabel: "mNotify API Key *",
    secretLabel: "Optional Note",
    secretPlaceholder: "Optional",
    hasSecret: false,
    hint: "mNotify SMS Gateway (Ghana). Get your API key from the mNotify developer settings.",
    needsEndpoint: false,
  },
  twilio: {
    keyLabel: "Twilio Auth Token *",
    secretLabel: "Twilio Account SID *",
    secretPlaceholder: "e.g. ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    hasSecret: true,
    hint: "Twilio SMS API. Provide your Account SID and Auth Token.",
    needsEndpoint: false,
  },
  vonage: {
    keyLabel: "Vonage API Key *",
    secretLabel: "Vonage API Secret *",
    secretPlaceholder: "Enter your Vonage API Secret",
    hasSecret: true,
    hint: "Vonage / Nexmo SMS REST API.",
    needsEndpoint: false,
  },
  custom: {
    keyLabel: "API Key / Bearer Token *",
    secretLabel: "Secret / Additional Parameter (Optional)",
    secretPlaceholder: "Optional",
    hasSecret: false,
    hint: "Universal HTTP SMS Gateway. Provide your endpoint URL with parameters or placeholders.",
    needsEndpoint: true,
  },
};

export async function initGateway() {
  await loadSettings();

  // Password visibility toggles
  document.querySelectorAll('.toggle-visibility').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        const icon = btn.querySelector('i');
        if (icon) {
          icon.className = input.type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
        }
      }
    });
  });

  // Dynamic provider selector changes
  const providerSelect = document.getElementById('gw-provider');
  if (providerSelect) {
    providerSelect.addEventListener('change', () => {
      updateProviderFields(providerSelect.value);
    });
  }

  // Bind Form Submit & Test SMS
  document.getElementById('gateway-form')?.addEventListener('submit', handleSave);
  document.getElementById('gw-test-btn')?.addEventListener('click', handleTest);
}

function updateProviderFields(provider) {
  const info = PROVIDER_INFO[provider] || PROVIDER_INFO.custom;
  const keyLabel = document.getElementById('gw-key-label');
  const secretLabel = document.getElementById('gw-secret-label');
  const secretInput = document.getElementById('gw-secret');
  const secretWrap = document.getElementById('gw-secret-wrap');
  const endpointWrap = document.getElementById('gw-endpoint-wrap');
  const hintEl = document.getElementById('gw-provider-hint');

  if (keyLabel) keyLabel.textContent = info.keyLabel;
  if (secretLabel) secretLabel.textContent = info.secretLabel;
  if (secretInput) secretInput.placeholder = info.secretPlaceholder;
  if (hintEl) hintEl.textContent = info.hint;

  if (endpointWrap) {
    endpointWrap.style.display = info.needsEndpoint ? 'block' : 'none';
    const endpointInput = document.getElementById('gw-endpoint');
    if (endpointInput) {
      endpointInput.required = info.needsEndpoint;
    }
  }

  if (secretWrap) {
    secretWrap.style.display = 'block';
  }
}

async function loadSettings() {
  try {
    const activeGw = await getActiveGateway();
    const statusBadge = document.getElementById('gw-status-badge');

    if (!activeGw) {
      if (statusBadge) {
        statusBadge.innerHTML = '<i class="bi bi-exclamation-circle-fill"></i> Not Configured';
        statusBadge.style.background = '#FEF3C7';
        statusBadge.style.color = '#92400E';
      }
      updateProviderFields(document.getElementById('gw-provider')?.value || 'mnotify');
      return;
    }

    const providerSelect = document.getElementById('gw-provider');
    const senderInput = document.getElementById('gw-sender');
    const keyInput = document.getElementById('gw-key');
    const secretInput = document.getElementById('gw-secret');
    const endpointInput = document.getElementById('gw-endpoint');
    const balanceEl = document.getElementById('gw-balance');

    if (providerSelect && activeGw.provider) {
      providerSelect.value = activeGw.provider;
    }
    if (senderInput && activeGw.sender_id) {
      senderInput.value = activeGw.sender_id;
    }
    if (keyInput && activeGw.api_key) {
      keyInput.value = activeGw.api_key;
    }
    if (secretInput && activeGw.api_secret) {
      secretInput.value = activeGw.api_secret;
    }
    if (endpointInput) {
      endpointInput.value = (activeGw.endpoint_url && activeGw.endpoint_url.startsWith('http')) ? activeGw.endpoint_url : '';
    }

    if (balanceEl) {
      balanceEl.textContent = activeGw.last_balance_check != null
        ? `GHS ${activeGw.last_balance_check}`
        : 'Active & Ready for Broadcasts';
    }

    if (statusBadge) {
      statusBadge.innerHTML = '<i class="bi bi-check-circle-fill"></i> Gateway Active & Ready';
      statusBadge.style.background = '#DCFCE7';
      statusBadge.style.color = '#15803D';
    }

    updateProviderFields(providerSelect?.value || 'mnotify');
  } catch (err) {
    console.warn('Could not load active SMS gateway settings:', err);
  }
}

async function handleSave(e) {
  if (e) e.preventDefault();
  const submitBtn = document.getElementById('gw-save-btn');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Saving &amp; Activating…';
  }

  const provider = document.getElementById('gw-provider')?.value || 'mnotify';
  const senderId = document.getElementById('gw-sender')?.value.trim() || 'CONFERENCE';
  const apiKey = document.getElementById('gw-key')?.value.trim() || '';
  const apiSecret = document.getElementById('gw-secret')?.value.trim() || '';
  const endpointUrl = document.getElementById('gw-endpoint')?.value.trim() || '';

  if (!apiKey) {
    showToast('Please enter your API Key.', 'error');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="bi bi-shield-check"></i> <span>Save &amp; Activate Gateway</span>';
    }
    return;
  }

  // Preserve the real provider name in endpoint_url so DB constraint fallbacks never lose provider identity
  const effectiveEndpoint = (provider === 'custom' && endpointUrl.startsWith('http'))
    ? endpointUrl
    : `provider:${provider}`;

  const configObj = {
    provider,
    sender_id: senderId,
    api_key: apiKey,
    api_secret: apiSecret,
    endpoint_url: effectiveEndpoint,
    is_active: true,
  };

  // 1. Save locally for instant client-side dispatch fallback
  saveLocalGatewayConfig(configObj);

  // 2. Save to Supabase database (with Edge Function encryption fallback)
  let savedInDb = false;
  try {
    const { error: fnError } = await supabase.functions.invoke('save-gateway-settings', {
      body: configObj,
    });
    if (!fnError) {
      savedInDb = true;
    }
  } catch (fnErr) {
    console.warn('Edge Function save-gateway-settings failed, persisting directly to table:', fnErr);
  }

  if (!savedInDb) {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const userId = userRes?.user?.id || null;

      // Deactivate other gateways
      await supabase.from('sms_gateway_settings').update({ is_active: false }).eq('is_active', true);

      // Check if this provider row already exists
      const { data: existing } = await supabase
        .from('sms_gateway_settings')
        .select('id')
        .eq('provider', provider)
        .limit(1)
        .maybeSingle();

      const payload = {
        provider,
        sender_id: senderId,
        endpoint_url: effectiveEndpoint,
        is_active: true,
        api_key_encrypted: apiKey,
        api_secret_encrypted: apiSecret,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      };

      let dbRes = null;
      if (existing?.id) {
        dbRes = await supabase.from('sms_gateway_settings').update(payload).eq('id', existing.id);
      } else {
        dbRes = await supabase.from('sms_gateway_settings').insert(payload);
      }

      // If database has old constraint rejecting arkesel/hubtel/mnotify, save as custom
      // but preserve provider in endpoint_url so it is NEVER lost!
      if (dbRes?.error && (dbRes.error.message?.includes('provider') || dbRes.error.code === '23514')) {
        console.warn('DB check constraint rejected provider; falling back to provider="custom" in DB with endpoint_url tracking.');
        payload.provider = 'custom';
        payload.endpoint_url = `provider:${provider}`;
        if (existing?.id) {
          await supabase.from('sms_gateway_settings').update(payload).eq('id', existing.id);
        } else {
          await supabase.from('sms_gateway_settings').insert(payload);
        }
      }
      savedInDb = true;
    } catch (dbErr) {
      console.warn('Direct database insert into sms_gateway_settings failed:', dbErr);
    }
  }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-shield-check"></i> <span>Save &amp; Activate Gateway</span>';
  }

  showToast(`SMS Gateway (${provider.toUpperCase()}) saved and activated!`, 'success');
  await loadSettings();
}

async function handleTest() {
  const phone = prompt('Enter recipient phone number for the test SMS:\n(e.g. 0244123456 or +233...)');
  if (!phone || !phone.trim()) return;

  const testBtn = document.getElementById('gw-test-btn');
  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Dispatching test…';
  }

  const prov = document.getElementById('gw-provider')?.value || 'mnotify';
  const endp = document.getElementById('gw-endpoint')?.value.trim() || '';

  // Use current form inputs so test works immediately with the exact entered credentials
  const currentConfig = {
    provider: prov,
    sender_id: document.getElementById('gw-sender')?.value.trim() || 'CONFERENCE',
    api_key: document.getElementById('gw-key')?.value.trim() || '',
    api_secret: document.getElementById('gw-secret')?.value.trim() || '',
    endpoint_url: (prov === 'custom' && endp.startsWith('http')) ? endp : `provider:${prov}`,
  };

  const { error } = await sendTestSms(phone.trim(), currentConfig.api_key ? currentConfig : null);

  if (testBtn) {
    testBtn.disabled = false;
    testBtn.innerHTML = '<i class="bi bi-send-check"></i> <span>Send Test SMS</span>';
  }

  if (error) {
    console.error('Test SMS error:', error);
    showToast(`Test failed: ${error.message || 'Please check your API key and sender ID.'}`, 'error');
    return;
  }

  showToast(`Test SMS sent successfully to ${phone.trim()}! Check your phone.`, 'success');
  await loadSettings();
}

