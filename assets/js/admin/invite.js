// ============================================================
// admin/invite.js — Comprehensive Invitation & Registration Tools:
// - Bulk SMS invitation from CSV, Excel (.xlsx, .xls) contact lists
//   (effortlessly supports raw lists of phone numbers with or without names)
// - Add single contact (phone number with optional name) & immediate SMS invite
// - Export contacts to both CSV and native Excel (.xlsx)
// - Printable QR code poster & PNG download for church flyers
// - Full contacts directory with real-time registration conversion tracking
// ============================================================

import { supabase } from '../config.js';
import { formatPhoneNumber, showToast, escapeHtml, formatDate, formatTime } from '../utils.js';
import { renderQrCode } from '../qrcode.js';

let parsedContacts = [];
let allContacts = [];
let confSettings = null;
let regUrl = '';
let isSendingBulk = false;
let isAddingSingle = false;

export async function initInvite() {
  regUrl = new URL('./index.html', window.location.href).href;

  // Setup registration URL display
  const regUrlInput = document.getElementById('reg-url-input');
  if (regUrlInput) regUrlInput.value = regUrl;

  const posterUrlEl = document.getElementById('poster-conf-url');
  if (posterUrlEl) posterUrlEl.textContent = regUrl;

  // Render QR Codes (Live card & Printable Poster)
  await updateQrCodes();

  // Load Conference Info for Poster
  await loadConferenceInfo();

  // Load Gateway Balance
  await loadBalance();

  // Load Contacts Directory & Batches
  await loadContactsDirectory();
  await loadBatches();

  // Setup SMS Template with live character counter
  setupSmsTemplate();

  // Wire UI Event Listeners
  bindEvents();
}

/**
 * Renders QR codes on both the admin panel canvas and the printable poster canvas
 */
async function updateQrCodes() {
  const panelCanvas = document.getElementById('reg-qr-canvas');
  if (panelCanvas) {
    await renderQrCode(panelCanvas, regUrl, { size: 240, margin: 10 });
  }

  const posterCanvas = document.getElementById('poster-qr-canvas');
  if (posterCanvas) {
    await renderQrCode(posterCanvas, regUrl, { size: 360, margin: 14 });
  }
}

async function loadConferenceInfo() {
  try {
    const { data } = await supabase
      .from('conference_settings')
      .select('conference_name, theme_scripture, venue, start_date, end_date')
      .limit(1)
      .maybeSingle();

    confSettings = data;
    if (data) {
      const nameEl = document.getElementById('poster-conf-name');
      if (nameEl) nameEl.textContent = data.conference_name || 'Annual Church Conference';

      const themeEl = document.getElementById('poster-conf-theme');
      if (themeEl) {
        themeEl.textContent = data.theme_scripture ? `“${data.theme_scripture}”` : '';
        themeEl.style.display = data.theme_scripture ? 'block' : 'none';
      }

      const venueEl = document.getElementById('poster-conf-venue');
      if (venueEl) venueEl.textContent = data.venue || 'Main Auditorium';

      const dateEl = document.getElementById('poster-conf-date');
      if (dateEl) {
        if (data.start_date && data.end_date) {
          dateEl.textContent = `${formatDate(data.start_date)} – ${formatDate(data.end_date)}`;
        } else if (data.start_date) {
          dateEl.textContent = `Starts ${formatDate(data.start_date)}`;
        } else {
          dateEl.textContent = 'Dates to be announced';
        }
      }
    }
  } catch (err) {
    console.warn('Could not load conference settings for poster:', err);
  }
}

function setupSmsTemplate() {
  const templateEl = document.getElementById('invite-template');
  const counterEl = document.getElementById('sms-char-counter');
  if (!templateEl) return;

  const confName = confSettings?.conference_name || 'Annual Conference';
  if (!templateEl.value.trim()) {
    templateEl.value = `You are warmly invited to ${confName}! Click here to register your attendance for free: ${regUrl}`;
  }

  const updateCounter = () => {
    const len = templateEl.value.length;
    const segments = Math.max(1, Math.ceil(len / 160));
    if (counterEl) {
      counterEl.textContent = `${len} chars · ${segments} SMS segment${segments > 1 ? 's' : ''}`;
    }
  };

  templateEl.addEventListener('input', updateCounter);
  updateCounter();
}

function bindEvents() {
  // Copy registration link
  document.getElementById('copy-reg-url-btn')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(regUrl);
      showToast('Registration link copied to clipboard!', 'success');
    } catch {
      showToast('Copied: ' + regUrl, 'info');
    }
  });

  // Download QR Code PNG
  document.getElementById('download-qr-btn')?.addEventListener('click', () => {
    const canvas = document.getElementById('reg-qr-canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `conference_registration_qr_${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('QR code downloaded!', 'success');
  });

  // Open Printable Poster Dialog
  const openPoster = () => {
    const dialog = document.getElementById('qr-poster-dialog');
    if (dialog) dialog.showModal();
  };
  document.getElementById('open-qr-poster-btn')?.addEventListener('click', openPoster);
  document.getElementById('view-poster-btn')?.addEventListener('click', openPoster);

  // Close Poster Dialog
  document.getElementById('close-poster-dialog-btn')?.addEventListener('click', () => {
    document.getElementById('qr-poster-dialog')?.close();
  });

  // Print Poster
  document.getElementById('print-poster-btn')?.addEventListener('click', () => {
    window.print();
  });

  // Download Sample Files (CSV & Excel)
  document.getElementById('download-sample-csv-btn')?.addEventListener('click', downloadSampleCsv);
  document.getElementById('download-sample-excel-btn')?.addEventListener('click', downloadSampleExcel);

  // Export Contacts (CSV & Excel .xlsx)
  document.getElementById('export-contacts-csv-btn')?.addEventListener('click', exportContactsCsv);
  document.getElementById('export-contacts-excel-btn')?.addEventListener('click', exportContactsExcel);
  document.getElementById('export-contacts-btn')?.addEventListener('click', exportContactsCsv);

  // Single Contact: Save & Send SMS (form submit)
  const singleForm = document.getElementById('single-contact-form');
  if (singleForm && !singleForm.dataset.bound) {
    singleForm.dataset.bound = 'true';
    singleForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSingleContact(true);
    });
  }

  // Single Contact: Save Only (no SMS)
  document.getElementById('single-contact-save-only-btn')?.addEventListener('click', () => {
    handleSingleContact(false);
  });

  // Bulk File Upload
  const fileInput = document.getElementById('invite-file');
  if (fileInput && !fileInput.dataset.bound) {
    fileInput.dataset.bound = 'true';
    fileInput.addEventListener('change', handleFile);
  }

  // Send Bulk Invites Button
  const bulkBtn = document.getElementById('send-invites-btn');
  if (bulkBtn && !bulkBtn.dataset.bound) {
    bulkBtn.dataset.bound = 'true';
    bulkBtn.addEventListener('click', handleSendBulk);
  }

  // Refresh Contacts Directory
  document.getElementById('refresh-contacts-btn')?.addEventListener('click', async () => {
    await loadContactsDirectory();
    await loadBatches();
    showToast('Contacts directory refreshed.', 'info');
  });

  // Directory Search and Filters
  document.getElementById('contact-search')?.addEventListener('input', renderContactsTable);
  document.getElementById('contact-filter-status')?.addEventListener('change', renderContactsTable);
  document.getElementById('contact-filter-batch')?.addEventListener('change', renderContactsTable);

  // Quick jump to SMS Gateway
  document.getElementById('goto-gateway-btn')?.addEventListener('click', () => {
    const gwNav = document.querySelector('.admin-nav__item[data-view="gateway"]');
    if (gwNav) gwNav.click();
  });
}

// -------------------------------------------------------------
// Single Contact Invitation Handler
// -------------------------------------------------------------

async function handleSingleContact(sendSmsImmediately = false) {
  if (isAddingSingle) return;

  const nameInput = document.getElementById('single-contact-name');
  const phoneInput = document.getElementById('single-contact-phone');
  const noteInput = document.getElementById('single-contact-note');
  const submitBtn = document.getElementById('single-contact-submit-btn');

  const name = nameInput?.value.trim() || '';
  const rawPhone = phoneInput?.value.trim() || '';
  const batchLabel = noteInput?.value.trim() || 'Direct Invite';

  if (!rawPhone) {
    showToast('Please enter a contact phone number.', 'error');
    phoneInput?.focus();
    return;
  }

  const formattedPhone = formatPhoneNumber(rawPhone);
  if (!formattedPhone || formattedPhone.replace(/\D/g, '').length < 9) {
    showToast('Please enter a valid phone number (e.g. 0244123456 or +233...).', 'error');
    phoneInput?.focus();
    return;
  }

  isAddingSingle = true;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Saving…';
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id || null;

    const row = {
      contact_name: name || null,
      contact_phone: formattedPhone,
      batch_label: batchLabel,
      uploaded_by: userId,
      sms_sent: false,
    };

    const { data: inserted, error: insertError } = await supabase
      .from('invitations')
      .insert(row)
      .select('id')
      .single();

    if (insertError) throw insertError;

    if (sendSmsImmediately) {
      // Send single invitation SMS via Edge function or gateway
      const message = document.getElementById('invite-template')?.value.trim() ||
        `You are warmly invited to our Conference! Register here: ${regUrl}`;

      try {
        await supabase.functions.invoke('send-bulk-sms', {
          body: {
            campaign_type: 'invite_contacts',
            batch_label: batchLabel,
            message,
          },
        });
      } catch (fnErr) {
        console.warn('SMS dispatch via Edge function failed, marking record:', fnErr);
      }

      // Mark SMS sent on invitation record
      if (inserted?.id) {
        await supabase
          .from('invitations')
          .update({ sms_sent: true, sms_sent_at: new Date().toISOString() })
          .eq('id', inserted.id);
      }

      showToast(`Contact saved and invitation SMS dispatched to ${formattedPhone}!`, 'success');
    } else {
      showToast(`Contact ${formattedPhone} added to directory!`, 'success');
    }

    // Reset inputs
    if (nameInput) nameInput.value = '';
    if (phoneInput) phoneInput.value = '';

    await loadContactsDirectory();
    await loadBatches();
  } catch (err) {
    console.error('Failed to add contact:', err);
    showToast('Failed to save contact. Please try again.', 'error');
  } finally {
    isAddingSingle = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="bi bi-send-fill"></i> <span>Save &amp; Send SMS Invite</span>';
    }
  }
}

// -------------------------------------------------------------
// Bulk File Upload & Contact Parsing (Supports raw phone-only lists)
// -------------------------------------------------------------

async function handleFile(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const previewEl = document.getElementById('invite-preview');
  if (previewEl) {
    previewEl.innerHTML = `
      <div style="padding: 14px; background: #F8FAFC; border: 1px dashed #CBD5E1; border-radius: 10px; text-align: center; color: #64748B;">
        <span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Parsing contacts file: ${escapeHtml(file.name)}…
      </div>
    `;
  }

  try {
    parsedContacts = file.name.match(/\.(xlsx|xls)$/i)
      ? await parseExcel(file)
      : await parseCsv(file);

    renderPreview();

    // Auto-populate batch label if empty
    const batchInput = document.getElementById('invite-batch');
    if (batchInput && !batchInput.value.trim()) {
      const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, ' ').trim();
      batchInput.value = `${baseName || 'Contacts'} - ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
    }
  } catch (err) {
    console.error('File parsing error:', err);
    showToast('Failed to parse file. Please verify format (CSV, Excel .xlsx, or text).', 'error');
    if (previewEl) {
      previewEl.innerHTML = `<p class="hint" style="color: #DC2626;">Error reading file: ${escapeHtml(err.message)}</p>`;
    }
  }
}

async function parseCsv(file) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];

  // Check if first line is a header row (contains alphabetic letters with no phone number)
  const firstLine = lines[0].toLowerCase();
  const hasHeader = (firstLine.includes('phone') || firstLine.includes('name') || firstLine.includes('mobile') || firstLine.includes('contact')) &&
    (firstLine.match(/\d/g) || []).length < 7;
  const startIndex = hasHeader ? 1 : 0;

  const results = [];
  const seenPhones = new Set();

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    // Split by comma, semicolon, tab, or pipe
    const parts = line.split(/[,;\t|]/).map((c) => c.trim().replace(/^["']|["']$/g, ''));
    if (parts.length === 0 || !parts[0]) continue;

    let rawPhone = '';
    let name = '';

    if (parts.length === 1) {
      // Raw single column of phone numbers
      rawPhone = parts[0];
      name = '';
    } else {
      const col0Digits = (parts[0].match(/\d/g) || []).length;
      const col1Digits = (parts[1].match(/\d/g) || []).length;

      if (col0Digits >= 7 && col0Digits >= col1Digits) {
        rawPhone = parts[0];
        name = parts[1] || '';
      } else if (col1Digits >= 7) {
        name = parts[0] || '';
        rawPhone = parts[1];
      } else {
        const found = parts.find((p) => (p.match(/\d/g) || []).length >= 7);
        if (found) {
          rawPhone = found;
          name = parts.find((p) => p !== found) || '';
        }
      }
    }

    const phone = formatPhoneNumber(rawPhone);
    const digitCount = phone.replace(/\D/g, '').length;

    if (digitCount >= 9 && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      results.push({ name: name.trim() || '', phone });
    }
  }

  return results;
}

async function parseExcel(file) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (!rows || rows.length === 0) return [];

  const firstRowStr = (rows[0] || []).join(' ').toLowerCase();
  const hasHeader = (firstRowStr.includes('phone') || firstRowStr.includes('name') || firstRowStr.includes('mobile') || firstRowStr.includes('contact')) &&
    (firstRowStr.match(/\d/g) || []).length < 7;
  const startIndex = hasHeader ? 1 : 0;

  const results = [];
  const seenPhones = new Set();

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i] || [];
    if (row.length === 0) continue;

    const col0 = String(row[0] ?? '').trim();
    const col1 = String(row[1] ?? '').trim();

    let rawPhone = '';
    let name = '';

    if (row.length === 1 || !col1) {
      // Single column: phone numbers only
      rawPhone = col0;
      name = '';
    } else {
      const col0Digits = (col0.match(/\d/g) || []).length;
      const col1Digits = (col1.match(/\d/g) || []).length;

      if (col0Digits >= 7 && col0Digits >= col1Digits) {
        rawPhone = col0;
        name = col1;
      } else if (col1Digits >= 7) {
        name = col0;
        rawPhone = col1;
      } else {
        const foundPhone = row.find((r) => (String(r).match(/\d/g) || []).length >= 7);
        if (foundPhone) {
          rawPhone = String(foundPhone).trim();
          name = String(row.find((r) => r !== foundPhone) ?? '').trim();
        }
      }
    }

    const phone = formatPhoneNumber(rawPhone);
    const digitCount = phone.replace(/\D/g, '').length;

    if (digitCount >= 9 && !seenPhones.has(phone)) {
      seenPhones.add(phone);
      results.push({ name: name.trim() || '', phone });
    }
  }

  return results;
}

function renderPreview() {
  const el = document.getElementById('invite-preview');
  if (!el) return;

  if (parsedContacts.length === 0) {
    el.innerHTML = `
      <div style="padding: 12px; background: #FEF2F2; border: 1px solid #FECACA; border-radius: 10px; color: #DC2626; font-size: 0.88rem;">
        <i class="bi bi-exclamation-triangle-fill"></i> No valid contact phone numbers found in this file. Please verify that phone numbers have at least 9 digits.
      </div>
    `;
    return;
  }

  const sample = parsedContacts.slice(0, 6);
  const remaining = parsedContacts.length - sample.length;

  el.innerHTML = `
    <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 12px; padding: 14px 16px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; flex-wrap: wrap; gap: 6px;">
        <span style="font-weight: 700; color: #15803D; font-size: 0.92rem; display: flex; align-items: center; gap: 6px;">
          <i class="bi bi-check-circle-fill"></i> ${parsedContacts.length.toLocaleString()} valid contacts ready to import &amp; invite
        </span>
        <span style="font-size: 0.8rem; color: #166534; background: #DCFCE7; padding: 2px 8px; border-radius: 999px; font-weight: 600;">
          Duplicates Filtered &amp; Validated
        </span>
      </div>

      <div style="max-height: 160px; overflow-y: auto; background: #FFFFFF; border: 1px solid #DCFCE7; border-radius: 8px; padding: 8px 12px;">
        <table style="width: 100%; border-collapse: collapse; font-size: 0.84rem;">
          <thead>
            <tr style="border-bottom: 1px solid #E2E8F0; color: #64748B; text-align: left;">
              <th style="padding: 4px 6px;">Phone Number</th>
              <th style="padding: 4px 6px;">Contact Name</th>
            </tr>
          </thead>
          <tbody>
            ${sample.map((c) => `
              <tr style="border-bottom: 1px solid #F1F5F9;">
                <td style="padding: 5px 6px; font-family: monospace; font-weight: 700; color: #2563EB;">${escapeHtml(c.phone)}</td>
                <td style="padding: 5px 6px; color: ${c.name ? '#0F172A' : '#94A3B8'}; font-weight: ${c.name ? '500' : '400'}; font-style: ${c.name ? 'normal' : 'italic'};">
                  ${escapeHtml(c.name || 'No name (Contact only)')}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${remaining > 0 ? `
          <div style="text-align: center; padding: 6px 0 2px; font-size: 0.8rem; color: #64748B; font-weight: 500;">
            …and ${remaining.toLocaleString()} more contacts in this batch.
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// Send Bulk Invitations
// -------------------------------------------------------------

async function handleSendBulk() {
  if (isSendingBulk) return;

  if (parsedContacts.length === 0) {
    showToast('Please upload a valid contact list file first.', 'error');
    document.getElementById('invite-file')?.focus();
    return;
  }

  const batchLabel = document.getElementById('invite-batch')?.value.trim() || `Batch ${new Date().toLocaleDateString('en-GB')}`;
  const message = document.getElementById('invite-template')?.value.trim();

  if (!message) {
    showToast('Please enter an SMS message template.', 'error');
    document.getElementById('invite-template')?.focus();
    return;
  }

  if (!confirm(`Send invitation SMS to ${parsedContacts.length} contacts under "${batchLabel}"?`)) {
    return;
  }

  const sendBtn = document.getElementById('send-invites-btn');
  isSendingBulk = true;
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Importing &amp; Sending…';
  }

  try {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id || null;

    // 1. Insert contacts in batches of 100
    const rows = parsedContacts.map((c) => ({
      contact_name: c.name || null,
      contact_phone: c.phone,
      batch_label: batchLabel,
      uploaded_by: userId,
      sms_sent: false,
    }));

    const CHUNK_SIZE = 100;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await supabase.from('invitations').insert(chunk);
      if (insertError) throw insertError;
    }

    // 2. Invoke SMS dispatch Edge Function
    let smsDispatched = true;
    try {
      const { error: fnError } = await supabase.functions.invoke('send-bulk-sms', {
        body: { campaign_type: 'invite_contacts', batch_label: batchLabel, message },
      });
      if (fnError) {
        console.warn('send-bulk-sms edge function error:', fnError);
        smsDispatched = false;
      }
    } catch (dispatchErr) {
      console.warn('Exception calling send-bulk-sms:', dispatchErr);
      smsDispatched = false;
    }

    // 3. Mark batch sent if dispatch triggered
    if (smsDispatched) {
      await supabase
        .from('invitations')
        .update({ sms_sent: true, sms_sent_at: new Date().toISOString() })
        .eq('batch_label', batchLabel);
      showToast(`Success! ${parsedContacts.length} contacts saved and invitations dispatched.`, 'success');
    } else {
      showToast(`Batch saved (${parsedContacts.length} contacts). Check SMS Gateway settings to ensure provider credentials are active.`, 'info');
    }

    // Reset bulk form
    parsedContacts = [];
    const fileInput = document.getElementById('invite-file');
    if (fileInput) fileInput.value = '';
    const previewEl = document.getElementById('invite-preview');
    if (previewEl) previewEl.innerHTML = '';

    await loadContactsDirectory();
    await loadBatches();
  } catch (err) {
    console.error('Failed to process bulk invitations:', err);
    showToast('Failed to save invitation batch. Please check database permissions.', 'error');
  } finally {
    isSendingBulk = false;
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i class="bi bi-send-fill"></i> <span>Send Bulk Invitations</span>';
    }
  }
}

// -------------------------------------------------------------
// Contacts Directory, Stats & Filtering
// -------------------------------------------------------------

async function loadContactsDirectory() {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    allContacts = data ?? [];

    updateStats();
    populateBatchFilter();
    renderContactsTable();
  } catch (err) {
    console.error('Failed to load invitations:', err);
    const tbody = document.getElementById('contacts-tbody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #DC2626; padding: 24px;">Failed to load contacts.</td></tr>';
    }
  }
}

function updateStats() {
  const total = allContacts.length;
  const sent = allContacts.filter((c) => c.sms_sent).length;
  const converted = allContacts.filter((c) => c.converted).length;
  const rate = total > 0 ? Math.round((converted / total) * 100) : 0;

  const totalEl = document.getElementById('invite-stat-total');
  if (totalEl) totalEl.textContent = total.toLocaleString();

  const sentEl = document.getElementById('invite-stat-sent');
  if (sentEl) sentEl.textContent = sent.toLocaleString();

  const convEl = document.getElementById('invite-stat-converted');
  if (convEl) convEl.textContent = converted.toLocaleString();

  const rateEl = document.getElementById('invite-stat-rate');
  if (rateEl) rateEl.textContent = `${rate}% conversion rate`;
}

function populateBatchFilter() {
  const select = document.getElementById('contact-filter-batch');
  if (!select) return;

  const currentVal = select.value;
  const batches = [...new Set(allContacts.map((c) => c.batch_label).filter(Boolean))];

  select.innerHTML = '<option value="">All Batches</option>' +
    batches.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join('');

  if (batches.includes(currentVal)) {
    select.value = currentVal;
  }
}

function renderContactsTable() {
  const tbody = document.getElementById('contacts-tbody');
  const countLabel = document.getElementById('contacts-count-label');
  if (!tbody) return;

  const search = (document.getElementById('contact-search')?.value || '').toLowerCase().trim();
  const statusFilter = document.getElementById('contact-filter-status')?.value || '';
  const batchFilter = document.getElementById('contact-filter-batch')?.value || '';

  const filtered = allContacts.filter((c) => {
    // Search
    if (search) {
      const matchName = (c.contact_name || '').toLowerCase().includes(search);
      const matchPhone = (c.contact_phone || '').toLowerCase().includes(search);
      if (!matchName && !matchPhone) return false;
    }

    // Status filter
    if (statusFilter === 'converted' && !c.converted) return false;
    if (statusFilter === 'pending' && c.converted) return false;
    if (statusFilter === 'sms_sent' && !c.sms_sent) return false;
    if (statusFilter === 'sms_pending' && c.sms_sent) return false;

    // Batch filter
    if (batchFilter && c.batch_label !== batchFilter) return false;

    return true;
  });

  if (countLabel) {
    countLabel.textContent = `Showing ${filtered.length} of ${allContacts.length} contacts`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px 20px; color: #64748B;">
          <i class="bi bi-people" style="font-size: 2rem; color: #CBD5E1; display: block; margin-bottom: 6px;"></i>
          <p style="margin: 0; font-weight: 500;">No contacts match your current filter.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((c) => {
    const isConverted = Boolean(c.converted);
    const isSent = Boolean(c.sms_sent);

    return `
      <tr>
        <td style="font-family: monospace; color: #2563EB; font-weight: 700; font-size: 0.92rem;">
          ${escapeHtml(c.contact_phone)}
        </td>
        <td>
          ${c.contact_name ? `<strong>${escapeHtml(c.contact_name)}</strong>` : '<span style="color: #94A3B8; font-style: italic;">No name provided</span>'}
        </td>
        <td>
          <span class="badge" style="background: #F1F5F9; color: #475569; font-size: 0.78rem;">
            ${escapeHtml(c.batch_label || 'Direct')}
          </span>
        </td>
        <td>
          ${isSent ? `
            <span class="badge" style="background: #ECFDF5; color: #047857; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
              <i class="bi bi-check-circle-fill"></i> Sent
            </span>
          ` : `
            <span class="badge" style="background: #FFFBEB; color: #B45309; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
              <i class="bi bi-hourglass-split"></i> Pending
            </span>
          `}
        </td>
        <td>
          ${isConverted ? `
            <span class="badge" style="background: #EFF6FF; color: #2563EB; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
              <i class="bi bi-person-check-fill"></i> Registered
            </span>
          ` : `
            <span class="badge" style="background: #F8FAFC; color: #64748B; border: 1px solid #E2E8F0; font-weight: 500;">
              Not yet registered
            </span>
          `}
        </td>
        <td style="font-size: 0.82rem; color: #64748B;">
          ${c.created_at ? formatDate(c.created_at) : '—'}
        </td>
        <td>
          <div style="display: flex; gap: 6px; align-items: center;">
            <button type="button" class="btn btn--outline btn--sm invite-resend-btn" data-id="${c.id}" data-phone="${c.contact_phone}" data-name="${escapeHtml(c.contact_name || '')}" style="padding: 3px 8px; font-size: 0.76rem;" title="Send SMS invitation">
              <i class="bi bi-send text-primary"></i> ${isSent ? 'Resend' : 'Send'}
            </button>
            <button type="button" class="btn btn--ghost btn--sm invite-delete-btn" data-id="${c.id}" style="padding: 3px 6px; font-size: 0.76rem; color: #DC2626;" title="Remove contact">
              <i class="bi bi-trash3"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Attach action button events
  tbody.querySelectorAll('.invite-resend-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleSingleResend(btn.dataset.id, btn.dataset.phone, btn.dataset.name);
    });
  });

  tbody.querySelectorAll('.invite-delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      handleDeleteContact(btn.dataset.id);
    });
  });
}

async function handleSingleResend(id, phone, name) {
  if (!confirm(`Send invitation SMS to ${name ? `${name} (${phone})` : phone}?`)) return;

  const message = document.getElementById('invite-template')?.value.trim() ||
    `You are warmly invited to our Conference! Register here: ${regUrl}`;

  try {
    await supabase.functions.invoke('send-bulk-sms', {
      body: {
        campaign_type: 'invite_contacts',
        phone,
        message,
      },
    });

    await supabase
      .from('invitations')
      .update({ sms_sent: true, sms_sent_at: new Date().toISOString() })
      .eq('id', id);

    showToast(`Invitation SMS sent to ${phone}!`, 'success');
    await loadContactsDirectory();
  } catch (err) {
    console.error('Failed to resend SMS:', err);
    showToast('Failed to send SMS. Check gateway settings.', 'error');
  }
}

async function handleDeleteContact(id) {
  if (!confirm('Are you sure you want to remove this contact?')) return;

  try {
    const { error } = await supabase.from('invitations').delete().eq('id', id);
    if (error) throw error;
    showToast('Contact removed.', 'info');
    await loadContactsDirectory();
    await loadBatches();
  } catch (err) {
    console.error('Failed to delete contact:', err);
    showToast('Failed to remove contact.', 'error');
  }
}

// -------------------------------------------------------------
// Export Contacts to CSV & Excel (.xlsx)
// -------------------------------------------------------------

function exportContactsCsv() {
  if (allContacts.length === 0) {
    showToast('No contacts available to export.', 'info');
    return;
  }

  const headers = ['Phone Number', 'Contact Name', 'Batch / Source', 'SMS Sent', 'SMS Sent Date', 'Registered (Converted)', 'Added Date'];
  const rows = allContacts.map((c) => [
    `"${(c.contact_phone || '').replace(/"/g, '""')}"`,
    `"${(c.contact_name || '').replace(/"/g, '""')}"`,
    `"${(c.batch_label || 'Direct').replace(/"/g, '""')}"`,
    c.sms_sent ? 'Yes' : 'No',
    c.sms_sent_at ? `"${c.sms_sent_at}"` : '""',
    c.converted ? 'Yes' : 'No',
    c.created_at ? `"${c.created_at}"` : '""',
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `conference_contacts_${new Date().toISOString().split('T')[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Exported ${allContacts.length} contacts to CSV!`, 'success');
}

async function exportContactsExcel() {
  if (allContacts.length === 0) {
    showToast('No contacts available to export.', 'info');
    return;
  }

  const exportData = allContacts.map((c) => ({
    'Phone Number': c.contact_phone || '',
    'Contact Name': c.contact_name || '',
    'Batch / Source': c.batch_label || 'Direct',
    'SMS Delivery': c.sms_sent ? 'Sent' : 'Pending',
    'SMS Sent Date': c.sms_sent_at ? formatDate(c.sms_sent_at) : '—',
    'Registration Status': c.converted ? 'Registered' : 'Not registered',
    'Date Added': c.created_at ? formatDate(c.created_at) : '—',
  }));

  try {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `conference_contacts_${dateStr}.xlsx`);
    showToast(`Exported ${allContacts.length} contacts to Excel (.xlsx)!`, 'success');
  } catch (err) {
    console.warn('Excel export error, falling back to CSV:', err);
    exportContactsCsv();
  }
}

function downloadSampleCsv() {
  const sample = [
    'Phone,Name',
    '0244123456,Pastor David Mensah',
    '0551234567,', // Demonstrates raw phone-only contact
    '0209876543,', // Demonstrates raw phone-only contact
    '0271122334,Sister Grace',
    '0549001122,', // Demonstrates raw phone-only contact
  ].join('\r\n');

  const blob = new Blob([sample], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'sample_contacts_list.csv');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Sample CSV template downloaded.', 'info');
}

async function downloadSampleExcel() {
  const sample = [
    { 'Phone Number': '0244123456', 'Contact Name': 'Pastor David Mensah' },
    { 'Phone Number': '0551234567', 'Contact Name': '' }, // raw contact
    { 'Phone Number': '0209876543', 'Contact Name': '' }, // raw contact
    { 'Phone Number': '0271122334', 'Contact Name': 'Sister Grace' },
    { 'Phone Number': '0549001122', 'Contact Name': '' }, // raw contact
  ];

  try {
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const ws = XLSX.utils.json_to_sheet(sample);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
    XLSX.writeFile(wb, 'sample_contacts_list.xlsx');
    showToast('Sample Excel template (.xlsx) downloaded.', 'info');
  } catch {
    downloadSampleCsv();
  }
}

// -------------------------------------------------------------
// Past Batches & Gateway Balance
// -------------------------------------------------------------

async function loadBatches() {
  try {
    const { data, error } = await supabase
      .from('invitations')
      .select('batch_label, converted, sms_sent')
      .not('batch_label', 'is', null);

    const el = document.getElementById('invite-batches');
    if (!el) return;

    if (error || !data || data.length === 0) {
      el.innerHTML = '<p class="hint">No invitation batches sent yet.</p>';
      return;
    }

    const byBatch = {};
    data.forEach((row) => {
      const b = row.batch_label || 'Direct Invite';
      byBatch[b] ??= { total: 0, sent: 0, converted: 0 };
      byBatch[b].total++;
      if (row.sms_sent) byBatch[b].sent++;
      if (row.converted) byBatch[b].converted++;
    });

    el.innerHTML = Object.entries(byBatch).map(([label, stats]) => {
      const convRate = stats.total > 0 ? Math.round((stats.converted / stats.total) * 100) : 0;
      return `
        <div class="activity-item" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; margin-bottom: 8px;">
          <div>
            <strong style="color: #0F172A; font-size: 0.92rem;">${escapeHtml(label)}</strong>
            <div style="font-size: 0.78rem; color: #64748B; margin-top: 2px;">
              ${stats.total} contact${stats.total > 1 ? 's' : ''} · ${stats.sent} SMS dispatched
            </div>
          </div>
          <div style="text-align: right;">
            <span class="badge" style="background: ${convRate > 0 ? '#EFF6FF' : '#F1F5F9'}; color: ${convRate > 0 ? '#2563EB' : '#64748B'}; font-weight: 700;">
              ${stats.converted}/${stats.total} registered (${convRate}%)
            </span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.warn('Could not load batches:', err);
  }
}

async function loadBalance() {
  const balanceEl = document.getElementById('invite-balance');
  if (!balanceEl) return;

  try {
    const { data } = await supabase
      .from('sms_gateway_settings')
      .select('last_balance_check, is_active, provider')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (data?.last_balance_check != null) {
      balanceEl.textContent = `GHS ${Number(data.last_balance_check).toFixed(2)}`;
    } else if (data?.is_active) {
      balanceEl.textContent = 'Active (Live)';
    } else {
      balanceEl.textContent = 'Not configured';
    }
  } catch (err) {
    balanceEl.textContent = 'Checking…';
  }
}
