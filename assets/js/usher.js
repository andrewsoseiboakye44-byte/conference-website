// ============================================================
// usher.js — 2-Task Door Attendance & Check-In Workflow (usher.html)
// Task 1: Already registered? Ask name(s) & church, count headcount, submit attendance.
// Task 2: Not registered? Register walk-in with standard form & tap instant attendance at bottom.
// Works seamlessly on iPhone/iPad (iOS Safari), Android, and all browsers.
// ============================================================

import { supabase } from './config.js';
import { requireRole, signOut } from './auth.js';
import { formatPhoneNumber, showToast, debounce, escapeHtml, formatDate } from './utils.js';

let currentProfile = null;
let currentConferenceSettings = null;
let selectedSessionDate = new Date().toISOString().split('T')[0];
let pendingCategory = 'person';
let isSubmitting = false;

function getIsoSessionTimestamp(sessionDate) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return `${sessionDate}T${timeStr}.000Z`;
}

init();

async function init() {
  currentProfile = await requireRole('usher');
  if (!currentProfile) return;

  // Logout button
  document.getElementById('logout-btn')?.addEventListener('click', signOut);

  // Manual refresh counter
  document.getElementById('refresh-counter-btn')?.addEventListener('click', async () => {
    await refreshTodayCount();
    showToast('Attendance count refreshed.', 'info');
  });

  // Load conference dates into session date selector
  await loadConferenceDates();

  // Load initial attendance count
  await refreshTodayCount();

  // Listen for realtime attendance inserts
  subscribeToCheckIns();

  // Setup the two tasks
  setupDoorSwitcher();
  setupTask1FastAttendance();
  setupTask2WalkInRegistration();
}

// -------------------------------------------------------------
// Conference Date & Session Management
// -------------------------------------------------------------

async function loadConferenceDates() {
  const dateSelect = document.getElementById('usher-session-date');
  const dayBadge = document.getElementById('session-day-badge');
  if (!dateSelect) return;

  try {
    const { data, error } = await supabase
      .from('conference_settings')
      .select('conference_name, start_date, end_date, schedule, venue')
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    currentConferenceSettings = data;

    const options = [];
    const todayStr = new Date().toISOString().split('T')[0];

    // Check if multi-day schedule JSON exists
    let scheduleDays = [];
    if (data?.schedule) {
      scheduleDays = Array.isArray(data.schedule) ? data.schedule : [];
    }

    if (scheduleDays.length > 0) {
      scheduleDays.forEach((day, idx) => {
        const dayLabel = day.day_title ? `${day.day_title} — ${day.theme || 'Program'}` : `Day ${idx + 1}`;
        const dayDate = day.date || todayStr;
        const formatted = formatDate(dayDate);
        options.push({
          date: dayDate,
          label: `${dayLabel} (${formatted})`,
        });
      });
    } else if (data?.start_date && data?.end_date) {
      // Build range between start_date and end_date
      let cur = new Date(data.start_date);
      const end = new Date(data.end_date);
      let dayNum = 1;
      while (cur <= end && dayNum <= 14) {
        const dStr = cur.toISOString().split('T')[0];
        options.push({
          date: dStr,
          label: `Day ${dayNum} (${formatDate(dStr)})`,
        });
        cur.setDate(cur.getDate() + 1);
        dayNum++;
      }
    }

    // Always ensure today or start date is an option
    if (options.length === 0) {
      options.push({
        date: todayStr,
        label: `Today (${formatDate(todayStr)})`,
      });
    }

    dateSelect.innerHTML = options.map((opt) => `
      <option value="${opt.date}">${escapeHtml(opt.label)}</option>
    `).join('');

    // Pre-select today if matched, otherwise first option
    const matchingToday = options.find((o) => o.date === todayStr);
    if (matchingToday) {
      dateSelect.value = todayStr;
      selectedSessionDate = todayStr;
    } else {
      selectedSessionDate = options[0].date;
      dateSelect.value = options[0].date;
    }

    if (dayBadge) {
      dayBadge.textContent = `${formatDate(selectedSessionDate)}`;
    }

    dateSelect.addEventListener('change', async (e) => {
      selectedSessionDate = e.target.value;
      if (dayBadge) {
        dayBadge.textContent = `${formatDate(selectedSessionDate)}`;
      }
      await refreshTodayCount();
    });
  } catch (err) {
    console.warn('Could not load conference session dates:', err);
    const todayStr = new Date().toISOString().split('T')[0];
    dateSelect.innerHTML = `<option value="${todayStr}">Today (${formatDate(todayStr)})</option>`;
    selectedSessionDate = todayStr;
  }
}

// -------------------------------------------------------------
// Live Headcount Attendance Counter
// -------------------------------------------------------------

async function refreshTodayCount() {
  const counterEl = document.getElementById('checked-in-count');
  if (!counterEl) return;

  try {
    // Sum all adults + children checked in on the selected session date
    const startOfSelectedDay = `${selectedSessionDate}T00:00:00.000Z`;
    const endOfSelectedDay = `${selectedSessionDate}T23:59:59.999Z`;

    const { data, error } = await supabase
      .from('check_ins')
      .select('adults, children')
      .gte('checked_in_at', startOfSelectedDay)
      .lte('checked_in_at', endOfSelectedDay);

    if (error) {
      // Fallback: simple count
      const { count } = await supabase
        .from('check_ins')
        .select('id', { count: 'exact', head: true })
        .gte('checked_in_at', startOfSelectedDay)
        .lte('checked_in_at', endOfSelectedDay);
      counterEl.textContent = count ?? 0;
      return;
    }

    let totalHeadcount = 0;
    (data || []).forEach((row) => {
      const pax = (Number(row.adults) || 1) + (Number(row.children) || 0);
      totalHeadcount += Math.max(1, pax);
    });

    counterEl.textContent = totalHeadcount.toLocaleString();
  } catch (err) {
    console.warn('Error refreshing today headcount:', err);
  }
}

function subscribeToCheckIns() {
  supabase
    .channel('check-ins-door-station')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins' }, () => {
      refreshTodayCount();
    })
    .subscribe();
}

// -------------------------------------------------------------
// The Door Question Switcher (YES vs NO)
// -------------------------------------------------------------

function setupDoorSwitcher() {
  const btnYes = document.getElementById('btn-switch-registered');
  const btnNo = document.getElementById('btn-switch-unregistered');
  const task1Card = document.getElementById('task1-card');
  const task2Card = document.getElementById('task2-card');
  const btnCancelToTask1 = document.getElementById('btn-cancel-to-task1');
  const btnWalkinCancel = document.getElementById('btn-walkin-cancel');

  const showTask1 = () => {
    task1Card.hidden = false;
    task2Card.hidden = true;
    btnYes.className = 'btn btn--primary btn--lg';
    btnNo.className = 'btn btn--outline btn--lg';
    document.getElementById('att-names')?.focus();
  };

  const showTask2 = () => {
    task1Card.hidden = true;
    task2Card.hidden = false;
    btnYes.className = 'btn btn--outline btn--lg';
    btnNo.className = 'btn btn--primary btn--lg';
    const firstInput = task2Card.querySelector('input[name="full_name"]');
    if (firstInput) firstInput.focus();
  };

  btnYes?.addEventListener('click', showTask1);
  btnNo?.addEventListener('click', showTask2);
  btnCancelToTask1?.addEventListener('click', showTask1);
  btnWalkinCancel?.addEventListener('click', showTask1);
}

// -------------------------------------------------------------
// TASK 1: Fast Door Attendance for Registered Attendees
// -------------------------------------------------------------

function setupTask1FastAttendance() {
  const searchInput = document.getElementById('registered-search-input');
  const namesInput = document.getElementById('att-names');
  const churchInput = document.getElementById('att-church');
  const paxInput = document.getElementById('att-pax-count');
  const btnMinus = document.getElementById('btn-pax-minus');
  const btnPlus = document.getElementById('btn-pax-plus');
  const form = document.getElementById('fast-attendance-form');

  // Headcount + / - buttons
  btnMinus?.addEventListener('click', () => {
    const cur = Math.max(1, (parseInt(paxInput.value, 10) || 1) - 1);
    paxInput.value = cur;
  });

  btnPlus?.addEventListener('click', () => {
    const cur = (parseInt(paxInput.value, 10) || 1) + 1;
    paxInput.value = cur;
  });

  // Headcount Preset Chips
  document.querySelectorAll('.pax-preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.val, 10) || 1;
      paxInput.value = val;
    });
  });

  // Live Auto-complete from registrants database
  if (searchInput) {
    searchInput.addEventListener('input', debounce(async () => {
      const q = searchInput.value.trim();
      const resultsEl = document.getElementById('registered-search-results');
      if (!resultsEl) return;

      if (!q || q.length < 2) {
        resultsEl.innerHTML = '';
        return;
      }

      const hasDigits = /\d/.test(q);
      const phoneQuery = hasDigits ? formatPhoneNumber(q) : null;
      const orFilter = phoneQuery
        ? `full_name.ilike.%${q}%,contact_phone.ilike.%${phoneQuery}%,church_affiliation.ilike.%${q}%`
        : `full_name.ilike.%${q}%,church_affiliation.ilike.%${q}%`;

      const { data, error } = await supabase
        .from('registrants')
        .select('id, full_name, category, church_affiliation, contact_phone, is_checked_in')
        .or(orFilter)
        .limit(6);

      if (error || !data || data.length === 0) {
        resultsEl.innerHTML = `
          <div style="padding: 10px 14px; font-size: 0.84rem; color: #64748B; background: #F8FAFC; border-radius: 8px;">
            No registered match found. Enter names manually below or click <strong>NO, NOT YET</strong> to register them.
          </div>
        `;
        return;
      }

      resultsEl.innerHTML = data.map((r) => `
        <button type="button" class="search-result" data-id="${r.id}" style="width: 100%; text-align: left; display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; margin-bottom: 6px; border: 1px solid #E2E8F0; border-radius: 10px; background: #FFFFFF; cursor: pointer;">
          <div>
            <strong style="color: #0F172A; font-size: 0.92rem; display: block;">${escapeHtml(r.full_name)}</strong>
            <span style="font-size: 0.78rem; color: #64748B;">
              ${escapeHtml(r.church_affiliation || r.category || 'Attendee')} · ${escapeHtml(r.contact_phone || '')}
            </span>
          </div>
          ${r.is_checked_in ? '<span class="badge badge--yes" style="font-size: 0.72rem;">Already checked in</span>' : '<span class="badge" style="background: #EFF6FF; color: #2563EB; font-size: 0.72rem;">Select</span>'}
        </button>
      `).join('');

      resultsEl.querySelectorAll('.search-result').forEach((btn) => {
        btn.addEventListener('click', () => {
          const item = data.find((x) => x.id === btn.dataset.id);
          if (item) {
            namesInput.value = item.full_name;
            churchInput.value = item.church_affiliation || 'General Fellowship';
            namesInput.dataset.registrantId = item.id;
            resultsEl.innerHTML = '';
            searchInput.value = '';
            paxInput.focus();
          }
        });
      });
    }, 300));
  }

  // Fast Attendance Form Submission
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const names = namesInput?.value.trim();
    const church = churchInput?.value.trim();
    const paxCount = Math.max(1, parseInt(paxInput?.value, 10) || 1);
    const existingRegistrantId = namesInput?.dataset.registrantId || null;

    if (!names) {
      showToast('Please enter the attendee name(s) or group leader.', 'error');
      namesInput?.focus();
      return;
    }

    if (!church) {
      showToast('Please enter their home church or ministry affiliation.', 'error');
      churchInput?.focus();
      return;
    }

    const submitBtn = document.getElementById('btn-submit-attendance');
    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Recording Attendance…';
    }

    try {
      const { data: userRes } = await supabase.auth.getUser();
      const usherUserId = userRes?.user?.id || null;

      // 1. If not linked to an existing registrant, create a quick door entry
      let regId = existingRegistrantId;
      if (!regId) {
        const { data: newReg, error: regError } = await supabase
          .from('registrants')
          .insert({
            category: paxCount > 1 ? 'church' : 'person',
            full_name: names,
            church_affiliation: church,
            contact_phone: '0000000000', // placeholder for quick door headcount
            is_checked_in: true,
            checked_in_at: new Date().toISOString(),
            registered_via: 'usher',
            registered_by: usherUserId,
          })
          .select('id')
          .single();

        if (!regError && newReg) {
          regId = newReg.id;
        }
      } else {
        // Mark existing registrant checked in
        await supabase
          .from('registrants')
          .update({ is_checked_in: true, checked_in_at: new Date().toISOString() })
          .eq('id', regId);
      }

      // 2. Insert check-in attendance row
      const { error: checkInError } = await supabase
        .from('check_ins')
        .insert({
          registrant_id: regId,
          sex: paxCount > 1 ? 'group' : 'male',
          adults: paxCount,
          children: 0,
          checked_in_by: usherUserId,
          checked_in_at: getIsoSessionTimestamp(selectedSessionDate),
        });

      if (checkInError) throw checkInError;

      // 3. Log usher activity
      await supabase.from('usher_activity_log').insert({
        usher_id: usherUserId,
        action: 'check_in',
        registrant_id: regId,
        details: {
          names,
          church,
          pax: paxCount,
          session_date: selectedSessionDate,
        },
      });

      showToast(`Admitted ${paxCount} person(s) (${names})! Attendance recorded.`, 'success');

      // Reset fields for the next person in line
      namesInput.value = '';
      churchInput.value = '';
      paxInput.value = '1';
      delete namesInput.dataset.registrantId;

      await refreshTodayCount();
      namesInput.focus();
    } catch (err) {
      console.error('Failed to submit attendance:', err);
      showToast('Could not record attendance. Please check network connection.', 'error');
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check2-circle"></i> <span>Record Daily Attendance &amp; Admit</span>';
      }
    }
  });
}

// -------------------------------------------------------------
// TASK 2: Walk-In Registration with Instant Daily Attendance
// -------------------------------------------------------------

function setupTask2WalkInRegistration() {
  const form = document.getElementById('walkin-register-form');
  const card = document.getElementById('task2-card');
  if (!form || !card) return;

  // Category Tab Switching
  card.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      card.querySelectorAll('.tab').forEach((t) => {
        t.classList.remove('tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('tab--active');
      tab.setAttribute('aria-selected', 'true');
      pendingCategory = tab.dataset.category;
      document.getElementById('walkin-category').value = pendingCategory;

      card.querySelectorAll('.reg-form__group').forEach((group) => {
        group.hidden = group.dataset.group !== pendingCategory;
      });

      // Default headcount adjust for group categories
      const paxInput = document.getElementById('walkin-pax');
      if (paxInput && (pendingCategory === 'institution' || pendingCategory === 'church')) {
        paxInput.value = '5';
      } else if (paxInput) {
        paxInput.value = '1';
      }
    });
  });

  // Instant Attendance Submit Button
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;

    const activeGroup = form.querySelector(`.reg-form__group[data-group="${pendingCategory}"]`);
    const getVal = (name) => activeGroup.querySelector(`[name="${name}"]`)?.value.trim() || '';

    const fullName = getVal('full_name');
    const rawPhone = getVal('contact_phone');
    const church = getVal('church_affiliation') || getVal('full_name');
    const location = getVal('location');
    const invitedBy = getVal('invited_by');
    const paxCount = Math.max(1, parseInt(document.getElementById('walkin-pax')?.value, 10) || 1);

    if (!fullName) {
      showToast('Please enter the attendee or organization name.', 'error');
      activeGroup.querySelector('[name="full_name"]')?.focus();
      return;
    }

    if (!rawPhone) {
      showToast('Contact phone number is required so they receive conference SMS messages.', 'error');
      activeGroup.querySelector('[name="contact_phone"]')?.focus();
      return;
    }

    const formattedPhone = formatPhoneNumber(rawPhone);
    if (!formattedPhone || formattedPhone.replace(/\D/g, '').length < 9) {
      showToast('Please enter a valid phone number (e.g. 0244123456 or +233...).', 'error');
      activeGroup.querySelector('[name="contact_phone"]')?.focus();
      return;
    }

    const submitBtn = document.getElementById('btn-walkin-instant-attendance');
    isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Registering &amp; Counting Attendance…';
    }

    try {
      const { data: userRes } = await supabase.auth.getUser();
      const usherUserId = userRes?.user?.id || null;

      // 1. Insert Registrant row
      const registrantPayload = {
        category: pendingCategory,
        full_name: fullName,
        location: location || null,
        contact_phone: formattedPhone,
        invited_by: invitedBy || null,
        is_checked_in: true,
        checked_in_at: new Date().toISOString(),
        registered_via: 'usher',
        registered_by: usherUserId,
      };

      if (pendingCategory === 'person') {
        registrantPayload.church_affiliation = church || null;
        registrantPayload.is_first_time = document.getElementById('walkin-first-time')?.checked ?? false;
      } else {
        registrantPayload.number_of_members = paxCount;
      }

      const { data: newReg, error: regError } = await supabase
        .from('registrants')
        .insert(registrantPayload)
        .select('id')
        .single();

      if (regError) throw regError;

      // 2. Insert into invitations table as well so SMS campaigns & invitations directory track this number
      try {
        await supabase.from('invitations').insert({
          contact_name: fullName,
          contact_phone: formattedPhone,
          batch_label: `Door Walk-in (${formatDate(selectedSessionDate)})`,
          converted: true,
          converted_at: new Date().toISOString(),
          sms_sent: false,
          uploaded_by: usherUserId,
        });
      } catch (invErr) {
        console.warn('Could not mirror contact to invitations:', invErr);
      }

      // 3. Immediately log attendance in check_ins for the selected date
      const { error: checkInError } = await supabase
        .from('check_ins')
        .insert({
          registrant_id: newReg.id,
          sex: paxCount > 1 ? 'group' : 'male',
          adults: paxCount,
          children: 0,
          checked_in_by: usherUserId,
          checked_in_at: getIsoSessionTimestamp(selectedSessionDate),
        });

      if (checkInError) throw checkInError;

      // 4. Log usher audit trail
      await supabase.from('usher_activity_log').insert({
        usher_id: usherUserId,
        action: 'new_registration',
        registrant_id: newReg.id,
        details: {
          full_name: fullName,
          phone: formattedPhone,
          pax: paxCount,
          session_date: selectedSessionDate,
        },
      });

      showToast(`Success! ${fullName} registered and counted (${paxCount} pax admitted).`, 'success');

      // Reset form
      form.reset();
      document.getElementById('walkin-pax').value = '1';

      await refreshTodayCount();

      // Return to Task 1 ready for the next person
      document.getElementById('btn-switch-registered')?.click();
    } catch (err) {
      console.error('Walk-in registration error:', err);
      showToast('Failed to complete walk-in registration. Please try again.', 'error');
    } finally {
      isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-person-check-fill"></i> <span>Save Registration &amp; Count Daily Attendance</span>';
      }
    }
  });
}

