// ============================================================
// admin/campaigns.js — SMS Campaigns & Broadcast Notifications.
// Supports manual message drafting for Pre-Event Reminders,
// Post-Event Thank You, Livestream Alerts, and targeting either
// registered attendees or all saved contacts on the system.
// ============================================================

import { supabase } from '../config.js';
import { sendCampaign, fetchSmsLogs } from '../sms.js';
import { showToast, formatTime, escapeHtml } from '../utils.js';

let conferenceSettings = null;
let recipientStats = {
  registrants: 0,
  allSavedAndRegistered: 0,
};

const CAMPAIGNS = [
  {
    type: 'auto_confirmation',
    title: 'Auto-Confirmation',
    icon: 'bi-robot',
    trigger: 'System (Automatic)',
    desc: 'Dispatched immediately upon every new registration. Configured automatically with instant SMS confirmation.',
    auto: true,
  },
  {
    type: 'save_the_date_alert',
    title: 'Pre-Registration / Save the Date',
    icon: 'bi-calendar2-heart-fill',
    trigger: 'Admin (Manual Broadcast)',
    desc: 'Send an advance announcement that the conference is scheduled and registration links will be published soon. Ideal when registration has not yet opened.',
    hasTextarea: true,
    defaultAudience: 'all_saved_and_registered',
    defaultMessage: (s) => `Save the Date! ${s?.conference_name || 'GET-WISDOM Conference'} is coming up! Prepare to attend. All conference information is live on our website, and registration links will open soon. Stay tuned!`,
  },
  {
    type: 'pre_event_reminder',
    title: 'Pre-Event Reminder',
    icon: 'bi-bell-fill',
    trigger: 'Admin (Manual Broadcast)',
    desc: 'Send countdown and logistical reminders to your audience before the conference begins.',
    hasTextarea: true,
    defaultMessage: (s) => `Reminder: ${s?.conference_name || 'Annual Conference'} is starting soon${s?.venue ? ' at ' + s.venue : ''}! We look forward to fellowship with you. Come expectant!`,
  },
  {
    type: 'livestream_alert',
    title: 'Livestream Alert',
    icon: 'bi-broadcast-pin',
    trigger: 'Admin (Manual Broadcast)',
    desc: 'Notify attendees that the conference service is currently streaming live on Facebook or YouTube.',
    hasTextarea: true,
    hasLiveLinks: true,
    defaultMessage: (s) => `${s?.conference_name || 'Conference'} is LIVE right now! Join us online for live worship and word exposition.`,
  },
  {
    type: 'post_event_thank_you',
    title: 'Post-Event Thank You',
    icon: 'bi-heart-fill',
    trigger: 'Admin (Manual Broadcast)',
    desc: 'Express gratitude to attendees after the conference, sharing blessings and future fellowship announcements.',
    hasTextarea: true,
    defaultMessage: (s) => `Thank you for attending ${s?.conference_name || 'our Annual Conference'}! We pray you were richly blessed and impartated. See you next time!`,
  },
];

export async function initCampaigns() {
  await loadRecipientStats();
  await loadConferenceSettings();
  renderCampaignCards();
  await refreshLog();

  const confirmInput = document.getElementById('confirm-send-input');
  if (confirmInput) {
    confirmInput.addEventListener('input', (e) => {
      const proceedBtn = document.getElementById('confirm-send-proceed');
      if (proceedBtn) {
        proceedBtn.disabled = e.target.value.trim() !== 'CONFIRM';
      }
    });
  }

  const closeConfirmModal = () => document.getElementById('confirm-send-modal')?.close();
  document.getElementById('confirm-send-cancel')?.addEventListener('click', closeConfirmModal);
  document.getElementById('confirm-send-close-x')?.addEventListener('click', closeConfirmModal);
}

async function loadConferenceSettings() {
  try {
    const { data } = await supabase
      .from('conference_settings')
      .select('*')
      .limit(1)
      .single();
    if (data) {
      conferenceSettings = data;
    }
  } catch (err) {
    console.warn('Could not load conference settings for campaigns:', err);
  }
}

async function loadRecipientStats() {
  try {
    // 1. Fetch exact registrant count
    const { count: regCount } = await supabase
      .from('registrants')
      .select('id', { count: 'exact', head: true });
    recipientStats.registrants = regCount ?? 0;

    // 2. Fetch distinct phone count combining registrants and invitations
    const [{ data: regs }, { data: invs }] = await Promise.all([
      supabase.from('registrants').select('contact_phone'),
      supabase.from('invitations').select('contact_phone'),
    ]);

    const uniquePhones = new Set();
    (regs || []).forEach((r) => {
      if (r.contact_phone && r.contact_phone.trim()) {
        uniquePhones.add(r.contact_phone.trim());
      }
    });
    (invs || []).forEach((i) => {
      if (i.contact_phone && i.contact_phone.trim()) {
        uniquePhones.add(i.contact_phone.trim());
      }
    });

    recipientStats.allSavedAndRegistered = Math.max(uniquePhones.size, recipientStats.registrants);
  } catch (err) {
    console.warn('Could not compute recipient statistics:', err);
  }
}

function renderCampaignCards() {
  const grid = document.getElementById('campaign-grid');
  if (!grid) return;

  grid.innerHTML = CAMPAIGNS.map((c) => {
    if (c.auto) {
      return `
        <div class="campaign-card campaign-card--auto" style="border-left: 4px solid #10B981;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
            <i class="bi ${c.icon}" style="font-size: 1.25rem; color: #10B981;"></i>
            <h3 style="margin: 0;">${escapeHtml(c.title)}</h3>
          </div>
          <p style="font-size: 0.9rem; color: #475569; margin-bottom: 12px;">${escapeHtml(c.desc)}</p>
          <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px;">
            <p style="margin: 0; font-size: 0.82rem; color: #166534; font-weight: 600;">
              <i class="bi bi-check-circle-fill"></i> Triggered automatically when attendee registers.
            </p>
          </div>
          <p class="hint" style="margin-top: auto;">Trigger: <strong>${escapeHtml(c.trigger)}</strong></p>
        </div>
      `;
    }

    const defaultMsg = c.defaultMessage ? c.defaultMessage(conferenceSettings) : '';

    return `
      <div class="campaign-card" id="card-${c.type}" style="display: flex; flex-direction: column; justify-content: space-between;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i class="bi ${c.icon} text-primary" style="font-size: 1.25rem;"></i>
              <h3 style="margin: 0;">${escapeHtml(c.title)}</h3>
            </div>
            <span class="badge" style="background: #EFF6FF; color: #2563EB; font-size: 0.72rem; font-weight: 700; padding: 3px 8px; border-radius: 999px;">
              Manual Send
            </span>
          </div>

          <p style="font-size: 0.88rem; color: #64748B; margin-bottom: 14px;">${escapeHtml(c.desc)}</p>

          <!-- Target Audience Selector -->
          <div class="field" style="margin-bottom: 12px;">
            <label for="aud-${c.type}" style="font-size: 0.8rem; font-weight: 700; color: #334155; display: flex; align-items: center; gap: 5px;">
              <i class="bi bi-people-fill text-primary"></i> Target Audience
            </label>
            <select id="aud-${c.type}" style="width: 100%; font-size: 0.85rem; padding: 7px 10px; border-radius: 8px; border: 1.5px solid #CBD5E1; background: #FFFFFF;">
              <option value="registrants" ${c.defaultAudience === 'registrants' || !c.defaultAudience ? 'selected' : ''}>
                Registered Attendees Only (${recipientStats.registrants} contact${recipientStats.registrants === 1 ? '' : 's'})
              </option>
              <option value="all_saved_and_registered" ${c.defaultAudience === 'all_saved_and_registered' ? 'selected' : ''}>
                All Contacts on System (${recipientStats.allSavedAndRegistered} contact${recipientStats.allSavedAndRegistered === 1 ? '' : 's'} — Registered + Directory)
              </option>
            </select>
            <span class="hint" style="font-size: 0.76rem; margin-top: 3px; display: block;">
              Select who should receive this broadcast.
            </span>
          </div>

          ${c.hasLiveLinks ? `
            <div class="field-row" style="margin-bottom: 10px; display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div class="field" style="margin-bottom: 0;">
                <label style="font-size: 0.78rem;">Facebook Live link</label>
                <input type="url" id="ls-fb" placeholder="https://facebook.com/..." value="${escapeHtml(conferenceSettings?.facebook_live_url || '')}" style="font-size: 0.82rem; padding: 6px 8px;" />
              </div>
              <div class="field" style="margin-bottom: 0;">
                <label style="font-size: 0.78rem;">YouTube Live link</label>
                <input type="url" id="ls-yt" placeholder="https://youtube.com/..." value="${escapeHtml(conferenceSettings?.youtube_live_url || '')}" style="font-size: 0.82rem; padding: 6px 8px;" />
              </div>
            </div>
          ` : ''}

          <!-- Editable SMS Message Textarea -->
          ${c.hasTextarea ? `
            <div class="field" style="margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <label for="msg-${c.type}" style="margin: 0; font-size: 0.8rem; font-weight: 700; color: #334155;">
                  SMS Message Body *
                </label>
                <span id="counter-${c.type}" style="font-size: 0.74rem; font-weight: 600; color: #64748B;">0 chars · 0 SMS</span>
              </div>
              <textarea id="msg-${c.type}" rows="3" style="width: 100%; font-size: 0.88rem; line-height: 1.45; border-radius: 8px; border: 1.5px solid #CBD5E1; padding: 8px 10px; box-sizing: border-box; resize: vertical;" placeholder="Type custom SMS content here...">${escapeHtml(defaultMsg)}</textarea>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                <span class="hint" style="font-size: 0.74rem; margin: 0;">Type custom wording or edit the template.</span>
                <button type="button" class="btn btn--ghost btn--sm" data-reset-template="${c.type}" style="font-size: 0.72rem; padding: 1px 6px; height: auto;">
                  <i class="bi bi-arrow-counterclockwise"></i> Reset template
                </button>
              </div>
            </div>
          ` : ''}
        </div>

        <div style="margin-top: 14px; pt-2; border-top: 1px solid #F1F5F9; padding-top: 12px;">
          <button class="btn btn--primary btn--block" data-send="${c.type}">
            <i class="bi bi-send-fill"></i> Send Broadcast
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire up live character counters and reset buttons
  CAMPAIGNS.forEach((c) => {
    if (!c.hasTextarea) return;
    const textarea = document.getElementById(`msg-${c.type}`);
    const counter = document.getElementById(`counter-${c.type}`);
    const resetBtn = grid.querySelector(`[data-reset-template="${c.type}"]`);

    const updateCounter = () => {
      if (!textarea || !counter) return;
      const len = textarea.value.length;
      const segments = Math.max(1, Math.ceil(len / 160));
      counter.textContent = `${len} char${len === 1 ? '' : 's'} · ${segments} SMS segment${segments > 1 ? 's' : ''}`;
    };

    if (textarea) {
      textarea.addEventListener('input', updateCounter);
      updateCounter();
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (textarea && c.defaultMessage) {
          textarea.value = c.defaultMessage(conferenceSettings);
          updateCounter();
          showToast('Template reset to default wording', 'info');
        }
      });
    }
  });

  // Wire send buttons
  grid.querySelectorAll('[data-send]').forEach((btn) => {
    btn.addEventListener('click', () => openConfirm(btn.dataset.send));
  });
}

async function openConfirm(campaignType) {
  const campaign = CAMPAIGNS.find((c) => c.type === campaignType);
  if (!campaign) return;

  const titleEl = document.getElementById('confirm-send-title');
  const bodyEl = document.getElementById('confirm-send-body');
  const inputEl = document.getElementById('confirm-send-input');
  const proceedBtn = document.getElementById('confirm-send-proceed');
  const modal = document.getElementById('confirm-send-modal');

  if (titleEl) {
    titleEl.innerHTML = `<i class="bi bi-send-exclamation-fill text-warning"></i> Confirm Broadcast: ${escapeHtml(campaign.title)}`;
  }

  // Determine chosen audience
  const audSelect = document.getElementById(`aud-${campaignType}`);
  const targetAudience = audSelect ? audSelect.value : 'registrants';

  // Read customized message text
  let customMessage = '';
  if (campaign.hasTextarea) {
    const textarea = document.getElementById(`msg-${campaignType}`);
    customMessage = textarea ? textarea.value.trim() : '';
    if (!customMessage) {
      showToast('Please type a message before sending.', 'error');
      textarea?.focus();
      return;
    }
  }

  // Fetch updated recipient counts
  await loadRecipientStats();

  let targetCount = targetAudience === 'all_saved_and_registered' 
    ? recipientStats.allSavedAndRegistered 
    : recipientStats.registrants;

  const audienceLabel = targetAudience === 'all_saved_and_registered'
    ? 'All Registered Attendees &amp; Saved Directory Contacts'
    : 'Registered Attendees Only';

  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="margin-bottom: 14px;">
        This will dispatch an SMS broadcast to <strong>${targetCount} recipient(s)</strong>.
      </div>

      <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 12px; margin-bottom: 14px;">
        <div style="font-size: 0.78rem; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 4px;">Audience Scope</div>
        <div style="font-size: 0.88rem; font-weight: 600; color: #0F172A; margin-bottom: 10px;">
          <i class="bi bi-people-fill text-primary"></i> ${audienceLabel} (<strong>${targetCount}</strong> recipients)
        </div>

        <div style="font-size: 0.78rem; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 4px;">Message Preview</div>
        <div style="font-size: 0.85rem; color: #1E293B; background: #FFFFFF; border: 1px solid #CBD5E1; border-radius: 6px; padding: 10px; white-space: pre-wrap; font-family: inherit;">
          ${escapeHtml(customMessage || '(Default server-generated message)')}
        </div>
      </div>

      <div style="font-size: 0.82rem; color: #64748B;">
        <i class="bi bi-info-circle-fill text-primary"></i> Every valid contact with an active phone number will receive this SMS via the configured SMS Gateway.
      </div>
    `;
  }

  if (inputEl) inputEl.value = '';
  if (proceedBtn) {
    proceedBtn.disabled = true;
    proceedBtn.onclick = () => executeSend(campaignType, customMessage, targetAudience);
  }

  modal?.showModal();
}

async function executeSend(campaignType, customMessage, targetAudience) {
  const proceedBtn = document.getElementById('confirm-send-proceed');
  const modal = document.getElementById('confirm-send-modal');

  if (proceedBtn) {
    proceedBtn.disabled = true;
    proceedBtn.innerHTML = `<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Dispatching SMS…`;
  }

  const extra = {
    message: customMessage,
    target_audience: targetAudience,
  };

  if (campaignType === 'livestream_alert') {
    extra.facebook_live_url = document.getElementById('ls-fb')?.value.trim();
    extra.youtube_live_url = document.getElementById('ls-yt')?.value.trim();
  }

  try {
    const { data, error } = await sendCampaign(campaignType, extra);

    if (error) {
      console.error('sendCampaign error:', error);
      showToast(`Send failed: ${error.message || 'Check SMS Gateway configuration'}`, 'error');
    } else {
      const sentCount = data?.sent ?? 0;
      const totalCount = data?.total ?? 0;
      showToast(`Broadcast completed! Sent ${sentCount} of ${totalCount} messages.`, 'success');
      modal?.close();
      await refreshLog();
    }
  } catch (err) {
    console.error('Execution exception:', err);
    showToast('Failed to dispatch campaign broadcast.', 'error');
  } finally {
    if (proceedBtn) {
      proceedBtn.disabled = false;
      proceedBtn.innerHTML = 'Send Broadcast';
    }
    if (modal?.open) {
      modal.close();
    }
  }
}

async function refreshLog() {
  const tbody = document.getElementById('sms-log-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await fetchSmsLogs(60);
    if (error || !data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748B; padding: 20px;">No SMS logs found yet.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map((log) => `
      <tr>
        <td style="font-family: monospace; font-weight: 600;">${escapeHtml(log.recipient_phone || '—')}</td>
        <td>
          <span style="font-weight: 500;">${escapeHtml(formatCampaignType(log.campaign_type))}</span>
        </td>
        <td>
          <span class="badge ${log.status === 'sent' ? 'badge--yes' : 'badge--no'}" style="text-transform: capitalize;">
            <i class="bi ${log.status === 'sent' ? 'bi-check-circle-fill' : 'bi-exclamation-triangle-fill'}"></i> ${escapeHtml(log.status || 'pending')}
          </span>
        </td>
        <td style="color: #64748B; font-size: 0.85rem;">${formatTime(log.sent_at)}</td>
      </tr>
    `).join('');
  } catch (err) {
    console.warn('Could not refresh SMS log:', err);
  }
}

function formatCampaignType(type) {
  if (!type) return 'Unknown';
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

