// ============================================================
// admin/registrants.js — full registrants table with search,
// filters, manual check-in toggle, manual registration modal,
// and CSV export.
// ============================================================

import { supabase } from '../config.js';
import { formatPhoneNumber, isValidPhoneNumber, debounce, downloadCsv, showToast, escapeHtml, formatDate, formatTime } from '../utils.js';
import { sendRegistrationConfirmationSms } from '../sms.js';

let manualCategory = 'person';
const cachedRegistrants = new Map();
let currentDetailsId = null;

export async function initRegistrants() {
  await loadTable();

  document.getElementById('registrant-search').addEventListener('input', debounce(loadTable, 300));
  document.getElementById('filter-category').addEventListener('change', loadTable);
  document.getElementById('filter-checkin').addEventListener('change', loadTable);
  document.getElementById('filter-first-time').addEventListener('change', loadTable);
  document.getElementById('export-csv-btn').addEventListener('click', exportCsv);

  document.getElementById('manual-register-btn').addEventListener('click', () => {
    document.getElementById('manual-register-modal').showModal();
  });
  document.getElementById('manual-register-cancel').addEventListener('click', () => {
    document.getElementById('manual-register-modal').close();
  });
  document.getElementById('manual-register-close-x')?.addEventListener('click', () => {
    document.getElementById('manual-register-modal').close();
  });
  document.querySelectorAll('#manual-register-modal .tab').forEach((tab) => {
    tab.addEventListener('click', () => switchManualTab(tab));
  });
  document.getElementById('manual-register-form').addEventListener('submit', handleManualRegister);

  // Registrant Details Modal event listeners
  document.getElementById('reg-details-close-x')?.addEventListener('click', () => {
    document.getElementById('registrant-details-modal')?.close();
  });
  document.getElementById('reg-details-close-btn')?.addEventListener('click', () => {
    document.getElementById('registrant-details-modal')?.close();
  });
  document.getElementById('reg-details-delete-btn')?.addEventListener('click', () => {
    if (!currentDetailsId) return;
    const r = cachedRegistrants.get(currentDetailsId);
    handleDeleteRegistrant(currentDetailsId, r?.full_name || 'this attendee', true);
  });
  document.getElementById('reg-details-toggle-checkin-btn')?.addEventListener('click', async () => {
    if (!currentDetailsId) return;
    const r = cachedRegistrants.get(currentDetailsId);
    await toggleCheckin(currentDetailsId, !!r?.is_checked_in);
    showRegistrantDetails(currentDetailsId);
  });
}

function buildQuery() {
  const search = document.getElementById('registrant-search').value.trim();
  const category = document.getElementById('filter-category').value;
  const checkedIn = document.getElementById('filter-checkin').value;
  const firstTime = document.getElementById('filter-first-time').value;

  let query = supabase.from('registrants').select('*').order('created_at', { ascending: false });

  if (search) {
    const sanitized = search.replace(/[,()]/g, '').trim();
    if (sanitized) {
      const hasDigits = /\d/.test(sanitized);
      const phone = hasDigits ? formatPhoneNumber(sanitized) : null;
      const orFilter = phone
        ? `full_name.ilike.%${sanitized}%,contact_phone.ilike.%${phone}%`
        : `full_name.ilike.%${sanitized}%`;
      query = query.or(orFilter);
    }
  }
  if (category) query = query.eq('category', category);
  if (checkedIn) query = query.eq('is_checked_in', checkedIn === 'true');
  if (firstTime) query = query.eq('is_first_time', true);

  return query.limit(500);
}

async function loadTable() {
  const { data, error } = await buildQuery();
  const tbody = document.getElementById('registrants-tbody');

  if (error || !data) {
    tbody.innerHTML = '<tr><td colspan="8">Could not load registrants.</td></tr>';
    return;
  }
  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8">No registrants match these filters.</td></tr>';
    return;
  }

  cachedRegistrants.clear();
  data.forEach((r) => cachedRegistrants.set(r.id, r));

  tbody.innerHTML = data.map((r) => `
    <tr data-id="${r.id}">
      <td>
        <strong class="view-registrant-link text-primary" data-id="${r.id}" style="cursor: pointer; text-decoration: underline dotted;" title="View attendee details">
          ${escapeHtml(r.full_name)}
        </strong>
      </td>
      <td><span class="badge" style="text-transform: capitalize;">${escapeHtml(r.category)}</span></td>
      <td><a href="tel:${escapeHtml(r.contact_phone)}" style="color: inherit; text-decoration: none; font-family: monospace;">${escapeHtml(r.contact_phone)}</a></td>
      <td>${escapeHtml(r.location ?? '—')}</td>
      <td>${escapeHtml(r.invited_by ?? '—')}</td>
      <td>${r.is_first_time ? '<span class="badge badge--yes">Yes</span>' : '—'}</td>
      <td><span class="badge ${r.is_checked_in ? 'badge--yes' : 'badge--no'}">${r.is_checked_in ? 'Checked in' : 'Not yet'}</span></td>
      <td>
        <div class="d-flex align-items-center gap-1" style="flex-wrap: nowrap;">
          <button class="btn btn--outline btn--sm toggle-checkin" data-id="${r.id}" data-checked="${r.is_checked_in}" title="${r.is_checked_in ? 'Undo attendance check-in' : 'Mark as checked in'}" style="padding: 4px 10px; font-size: 0.78rem; white-space: nowrap;">
            <i class="bi ${r.is_checked_in ? 'bi-arrow-counterclockwise' : 'bi-check2'}"></i>
            <span>${r.is_checked_in ? 'Undo' : 'Check in'}</span>
          </button>
          <button class="btn btn--outline btn--sm view-registrant-btn" data-id="${r.id}" title="View all attendee details" style="padding: 4px 8px; font-size: 0.78rem; color: #2563EB; white-space: nowrap;">
            <i class="bi bi-eye-fill"></i>
            <span>Details</span>
          </button>
          <button class="btn btn--outline btn--sm delete-registrant-btn" data-id="${r.id}" data-name="${escapeHtml(r.full_name)}" title="Delete registrant and details" style="padding: 4px 10px; font-size: 0.78rem; color: #DC2626; border-color: #F87171; background: #FEF2F2; font-weight: 700; white-space: nowrap;">
            <i class="bi bi-trash3-fill"></i>
            <span>Delete</span>
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.toggle-checkin').forEach((btn) => {
    btn.addEventListener('click', () => toggleCheckin(btn.dataset.id, btn.dataset.checked === 'true'));
  });

  tbody.querySelectorAll('.view-registrant-btn, .view-registrant-link').forEach((el) => {
    el.addEventListener('click', () => showRegistrantDetails(el.dataset.id));
  });

  tbody.querySelectorAll('.delete-registrant-btn').forEach((btn) => {
    btn.addEventListener('click', () => handleDeleteRegistrant(btn.dataset.id, btn.dataset.name));
  });
}

function showRegistrantDetails(id) {
  const r = cachedRegistrants.get(id);
  if (!r) return;

  currentDetailsId = id;
  const content = document.getElementById('reg-details-content');
  if (!content) return;

  const regDate = r.created_at ? `${formatDate(r.created_at)} at ${formatTime(r.created_at)}` : 'Unknown';
  const checkinTime = r.checked_in_at ? `${formatDate(r.checked_in_at)} at ${formatTime(r.checked_in_at)}` : 'Not recorded';

  content.innerHTML = `
    <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 14px 16px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
        <div>
          <h3 style="margin: 0 0 4px; font-size: 1.2rem; font-weight: 800; color: #0F172A;">${escapeHtml(r.full_name)}</h3>
          <span class="badge" style="text-transform: capitalize; background: #DBEAFE; color: #1E40AF; font-weight: 700;">${escapeHtml(r.category)} Attendee</span>
        </div>
        <span class="badge ${r.is_checked_in ? 'badge--yes' : 'badge--no'}" style="font-size: 0.8rem; padding: 4px 10px;">
          <i class="bi ${r.is_checked_in ? 'bi-check-circle-fill' : 'bi-clock-fill'}"></i>
          ${r.is_checked_in ? 'Checked In' : 'Not Checked In'}
        </span>
      </div>
      <p style="margin: 0; color: #64748B; font-size: 0.82rem;">Registered on ${regDate} via <strong>${escapeHtml(r.registered_via || 'public')}</strong></p>
    </div>

    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 4px;">
      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #64748B; display: block; margin-bottom: 2px;">Contact Phone</span>
        <a href="tel:${escapeHtml(r.contact_phone)}" style="font-size: 0.95rem; font-weight: 700; color: #2563EB; text-decoration: none; font-family: monospace;">
          <i class="bi bi-telephone-fill"></i> ${escapeHtml(r.contact_phone)}
        </a>
      </div>

      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #64748B; display: block; margin-bottom: 2px;">City / Location</span>
        <strong style="font-size: 0.95rem; color: #0F172A;">${escapeHtml(r.location || 'Not specified')}</strong>
      </div>

      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #64748B; display: block; margin-bottom: 2px;">Church Affiliation</span>
        <strong style="font-size: 0.95rem; color: #0F172A;">${escapeHtml(r.church_affiliation || 'None / Not stated')}</strong>
      </div>

      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #64748B; display: block; margin-bottom: 2px;">Invited By</span>
        <strong style="font-size: 0.95rem; color: #0F172A;">${escapeHtml(r.invited_by || 'Direct / Walk-in')}</strong>
      </div>

      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #64748B; display: block; margin-bottom: 2px;">First-Time Attendee</span>
        <strong style="font-size: 0.95rem; color: #0F172A;">${r.is_first_time ? 'Yes (First Time)' : 'No (Returning)'}</strong>
      </div>

      <div style="background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 8px; padding: 10px 12px;">
        <span style="font-size: 0.75rem; text-transform: uppercase; font-weight: 700; color: #64748B; display: block; margin-bottom: 2px;">Headcount / Members</span>
        <strong style="font-size: 0.95rem; color: #0F172A;">${r.number_of_members ? `${r.number_of_members} people` : '1 person'}</strong>
      </div>
    </div>

    ${r.is_checked_in ? `
      <div style="background: #F0FDF4; border: 1px solid #BBF7D0; border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 8px; color: #166534; font-size: 0.85rem;">
        <i class="bi bi-check-circle-fill" style="font-size: 1.1rem; color: #16A34A;"></i>
        <span>Admitted at door on <strong>${checkinTime}</strong></span>
      </div>
    ` : ''}
  `;

  const checkinBtnText = document.getElementById('reg-details-checkin-text');
  if (checkinBtnText) {
    checkinBtnText.textContent = r.is_checked_in ? 'Undo Check In' : 'Check In Attendee';
  }

  document.getElementById('registrant-details-modal')?.showModal();
}

async function handleDeleteRegistrant(id, name, closeDetailsModal = false) {
  const confirmed = confirm(
    `Are you sure you want to permanently delete "${name || 'this registrant'}" from the system?\n\n` +
    `This will completely erase their registration details and any recorded door attendance check-ins.`
  );
  if (!confirmed) return;

  try {
    // 1. Delete associated check-in records to maintain relational integrity
    await supabase.from('check_ins').delete().eq('registrant_id', id);

    // 2. Unlink any converted invitations
    await supabase.from('invitations').update({ converted: false, registrant_id: null }).eq('registrant_id', id);

    // 3. Delete registrant row
    const { error } = await supabase.from('registrants').delete().eq('id', id);

    if (error) throw error;

    showToast(`Registrant "${name}" and all details deleted successfully.`, 'success');
    if (closeDetailsModal) {
      document.getElementById('registrant-details-modal')?.close();
    }
    await loadTable();
  } catch (err) {
    console.error('Failed to delete registrant:', err);
    showToast(`Failed to delete registrant: ${err.message || 'Permission denied'}`, 'error');
  }
}

async function toggleCheckin(id, isCurrentlyCheckedIn) {
  const { error } = await supabase
    .from('registrants')
    .update({
      is_checked_in: !isCurrentlyCheckedIn,
      checked_in_at: !isCurrentlyCheckedIn ? new Date().toISOString() : null,
    })
    .eq('id', id);

  if (error) {
    showToast('Could not update check-in status.', 'error');
    return;
  }

  if (!isCurrentlyCheckedIn) {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('check_ins').insert({
      registrant_id: id,
      sex: 'group',
      adults: 1,
      children: 0,
      checked_in_by: user.id,
    });
  } else {
    await supabase.from('check_ins').delete().eq('registrant_id', id);
  }

  await loadTable();
}

async function exportCsv() {
  const { data, error } = await buildQuery();
  if (error || !data || data.length === 0) {
    showToast('Nothing to export.', 'error');
    return;
  }
  downloadCsv(`registrants-${new Date().toISOString().slice(0, 10)}.csv`, data);
}

// ---------- Manual registration modal ----------

function switchManualTab(tab) {
  document.querySelectorAll('#manual-register-modal .tab').forEach((t) => {
    t.classList.toggle('tab--active', t === tab);
  });
  manualCategory = tab.dataset.category;
  document.getElementById('manual-category').value = manualCategory;
  document.querySelectorAll('#manual-register-modal .reg-form__group').forEach((g) => {
    g.hidden = g.dataset.group !== manualCategory;
  });

  const subtitle = document.getElementById('manual-category-subtitle');
  if (subtitle) {
    if (manualCategory === 'person') {
      subtitle.textContent = 'Register an individual attendee, family, or personal member.';
    } else if (manualCategory === 'institution') {
      subtitle.textContent = 'Register on behalf of an academic, ministry, or corporate body.';
    } else if (manualCategory === 'church') {
      subtitle.textContent = 'Register an official delegation from a partner or invited church.';
    }
  }
}

function clearModalErrors(scope) {
  scope.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
}

function setModalFieldError(inputEl, message) {
  if (!inputEl) return;
  const field = inputEl.closest('.field');
  if (field) {
    field.classList.add('has-error');
    const errSpan = field.querySelector('.error');
    if (errSpan && message) errSpan.textContent = message;
  }
}

async function handleManualRegister(e) {
  e.preventDefault();
  const form = e.target;
  const group = form.querySelector(`.reg-form__group[data-group="${manualCategory}"]`);
  const getField = (name) => group.querySelector(`[name="${name}"]`);

  clearModalErrors(group);

  const fullName = getField('full_name')?.value.trim();
  const phoneRaw = getField('contact_phone')?.value.trim();
  const phone = formatPhoneNumber(phoneRaw);

  let hasError = false;
  if (!fullName) {
    setModalFieldError(getField('full_name'), 'Please enter the attendee or organization name.');
    hasError = true;
  }
  if (!isValidPhoneNumber(phone)) {
    setModalFieldError(getField('contact_phone'), 'Please enter a valid phone number (e.g. 024 123 4567).');
    hasError = true;
  }

  if (hasError) {
    showToast('Please correct the highlighted fields before submitting.', 'error');
    return;
  }

  const submitBtn = document.getElementById('manual-submit-btn');
  const originalBtnHtml = submitBtn ? submitBtn.innerHTML : 'Register Attendee';

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `
      <span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span>
      <span>Registering Attendee…</span>
    `;
  }

  try {
    const { data: userRes } = await supabase.auth.getUser();
    const userId = userRes?.user?.id || null;

    const shouldCheckIn = document.getElementById('manual-checkin-now')?.checked ?? false;
    const paxCount = manualCategory === 'person' 
      ? 1 
      : (Math.max(1, parseInt(getField('number_of_members')?.value, 10) || 1));

    const payload = {
      category: manualCategory,
      full_name: fullName,
      location: getField('location')?.value.trim() || null,
      contact_phone: phone,
      invited_by: getField('invited_by')?.value.trim() || null,
      registered_via: 'admin',
      registered_by: userId,
      is_checked_in: shouldCheckIn,
      checked_in_at: shouldCheckIn ? new Date().toISOString() : null,
    };

    if (manualCategory === 'person') {
      payload.church_affiliation = getField('church_affiliation')?.value.trim() || null;
      payload.is_first_time = getField('is_first_time')?.checked ?? false;
    } else {
      payload.number_of_members = paxCount;
    }

    const { data: newReg, error: regError } = await supabase
      .from('registrants')
      .insert(payload)
      .select('id')
      .single();

    if (regError) {
      console.error('Manual registration error:', regError);
      showToast('Registration failed: ' + (regError.message || 'Please check input data'), 'error');
      return;
    }

    // If marked checked-in, insert into check_ins table so dashboard live counter updates immediately
    if (shouldCheckIn && newReg?.id) {
      try {
        await supabase.from('check_ins').insert({
          registrant_id: newReg.id,
          sex: manualCategory === 'person' ? 'male' : 'group',
          adults: paxCount,
          children: 0,
          checked_in_by: userId,
          checked_in_at: new Date().toISOString()
        });
      } catch (checkErr) {
        console.warn('Check-in log recording error:', checkErr);
      }
    }

    // Fire-and-forget confirmation SMS via proxy
    sendRegistrationConfirmationSms({
      fullName,
      phone,
      registrantId: newReg?.id,
    }).catch((smsErr) => console.warn('Confirmation SMS failed to dispatch:', smsErr));

    showToast(`Successfully registered ${fullName}!`, 'success');
    form.reset();
    document.getElementById('manual-register-modal').close();
    await loadTable();
  } catch (err) {
    console.error('Unexpected error in manual registration:', err);
    showToast('An unexpected error occurred. Please try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnHtml;
    }
  }
}
