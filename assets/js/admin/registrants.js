// ============================================================
// admin/registrants.js — full registrants table with search,
// filters, manual check-in toggle, manual registration modal,
// and CSV export.
// ============================================================

import { supabase } from '../config.js';
import { formatPhoneNumber, isValidPhoneNumber, debounce, downloadCsv, showToast, escapeHtml } from '../utils.js';
import { sendRegistrationConfirmationSms } from '../sms.js';

let manualCategory = 'person';

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

  tbody.innerHTML = data.map((r) => `
    <tr data-id="${r.id}">
      <td>${escapeHtml(r.full_name)}</td>
      <td>${escapeHtml(r.category)}</td>
      <td>${escapeHtml(r.contact_phone)}</td>
      <td>${escapeHtml(r.location ?? '')}</td>
      <td>${escapeHtml(r.invited_by ?? '')}</td>
      <td>${r.is_first_time ? 'Yes' : '—'}</td>
      <td><span class="badge ${r.is_checked_in ? 'badge--yes' : 'badge--no'}">${r.is_checked_in ? 'Checked in' : 'Not yet'}</span></td>
      <td><button class="btn btn--outline toggle-checkin" data-id="${r.id}" data-checked="${r.is_checked_in}">
        ${r.is_checked_in ? 'Undo' : 'Check in'}
      </button></td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.toggle-checkin').forEach((btn) => {
    btn.addEventListener('click', () => toggleCheckin(btn.dataset.id, btn.dataset.checked === 'true'));
  });
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
