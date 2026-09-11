// ============================================================
// admin/users.js — usher account management.
// Creating an auth user requires the service_role key, so account
// creation and password resets are delegated to Edge Functions,
// with friendly error handling and clear credentials guidance.
// ============================================================

import { supabase } from '../config.js';
import { showToast, formatDate, formatTime, escapeHtml } from '../utils.js';

export async function initUsers() {
  await loadUshers();
  await loadUsherActivityLog();

  const form = document.getElementById('add-usher-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = 'true';
    form.addEventListener('submit', handleCreate);
  }

  const refreshActivityBtn = document.getElementById('refresh-usher-activity-btn');
  if (refreshActivityBtn && !refreshActivityBtn.dataset.bound) {
    refreshActivityBtn.dataset.bound = 'true';
    refreshActivityBtn.addEventListener('click', async () => {
      refreshActivityBtn.classList.add('btn-spinning');
      try {
        await loadUsherActivityLog();
        showToast('Usher activity log refreshed.', 'info');
      } finally {
        setTimeout(() => refreshActivityBtn.classList.remove('btn-spinning'), 500);
      }
    });
  }
}

async function loadUshers() {
  const tbody = document.getElementById('ushers-tbody');
  if (!tbody) return;

  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, is_active, created_at')
    .eq('role', 'usher')
    .order('created_at', { ascending: false });

  if (error || !data || data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748B; padding: 24px;">No door usher accounts created yet. Use the form above to create one.</td></tr>';
    return;
  }

  tbody.innerHTML = data.map((u) => `
    <tr>
      <td style="font-weight: 700; color: #0F172A;">
        <i class="bi bi-person-badge text-primary me-1"></i> ${escapeHtml(u.username)}
      </td>
      <td>
        <span class="badge ${u.is_active ? 'badge--yes' : 'badge--no'}">
          <i class="bi ${u.is_active ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}"></i>
          ${u.is_active ? 'Active' : 'Disabled'}
        </span>
      </td>
      <td style="color: #64748B; font-size: 0.85rem;">${formatDate(u.created_at)}</td>
      <td class="btn-row" style="gap: 8px;">
        <button class="btn btn--outline btn--sm" data-toggle="${u.id}" data-active="${u.is_active}">
          ${u.is_active ? '<i class="bi bi-pause-circle"></i> Disable' : '<i class="bi bi-play-circle"></i> Enable'}
        </button>
        <button class="btn btn--ghost btn--sm" data-reset="${u.id}" data-username="${escapeHtml(u.username)}">
          <i class="bi bi-key"></i> Reset password
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleActive(btn.dataset.toggle, btn.dataset.active === 'true'));
  });
  tbody.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => resetPassword(btn.dataset.reset, btn.dataset.username));
  });
}

async function handleCreate(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('usher-username-new');
  const passwordInput = document.getElementById('usher-password-new');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  const rawUsername = usernameInput?.value.trim().toLowerCase();
  const password = passwordInput?.value;

  if (!rawUsername || !password || password.length < 6) {
    showToast('Username and a password with at least 6 characters are required.', 'error');
    return;
  }

  // Sanitize username: remove spaces
  const cleanUsername = rawUsername.replace(/[^a-z0-9_.-]/g, '');

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Creating Account…';
  }

  try {
    const { data, error } = await supabase.functions.invoke('create-usher', {
      body: { username: cleanUsername, password },
    });

    if (error) {
      console.error('create-usher function error:', error);
      const msg = error.message || 'Check database permissions.';
      showToast(`Could not create usher: ${msg}`, 'error');
      return;
    }

    showToast(`Door usher account "${cleanUsername}" created successfully!`, 'success');
    e.target.reset();
    await loadUshers();
  } catch (err) {
    console.error('Account creation exception:', err);
    showToast('Failed to connect to authentication service.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="bi bi-person-check-fill"></i> <span>Create Usher Account</span>';
    }
  }
}

async function toggleActive(id, isCurrentlyActive) {
  const { error } = await supabase
    .from('profiles')
    .update({ is_active: !isCurrentlyActive })
    .eq('id', id);

  if (error) {
    showToast('Could not update account status.', 'error');
    return;
  }
  showToast(isCurrentlyActive ? 'Usher account disabled.' : 'Usher account enabled.', 'success');
  await loadUshers();
}

async function resetPassword(id, username) {
  const newPassword = prompt(`Enter new password for usher "${username}" (minimum 6 characters):`);
  if (!newPassword || newPassword.length < 6) {
    if (newPassword !== null) {
      showToast('Password must be at least 6 characters.', 'error');
    }
    return;
  }

  try {
    const { error } = await supabase.functions.invoke('reset-usher-password', {
      body: { user_id: id, password: newPassword },
    });

    if (error) {
      console.error('reset-usher-password error:', error);
      showToast(`Password reset failed: ${error.message || 'Check connection'}`, 'error');
      return;
    }

    showToast(`Password for "${username}" updated successfully!`, 'success');
  } catch (err) {
    console.error('Exception resetting password:', err);
    showToast('Failed to reset password.', 'error');
  }
}

async function loadUsherActivityLog() {
  const tbody = document.getElementById('usher-activity-tbody');
  if (!tbody) return;

  try {
    const { data, error } = await supabase
      .from('usher_activity_log')
      .select('id, action, registrant_id, details, created_at, registrants(full_name, church_affiliation)')
      .order('created_at', { ascending: false })
      .limit(60);

    if (error || !data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #94A3B8; padding: 24px;">No door activity recorded yet. Entries will appear as ushers take attendance or register walk-ins.</td></tr>';
      return;
    }

    tbody.innerHTML = data.map((log) => {
      const actionBadge = log.action === 'check_in'
        ? '<span class="badge badge--yes"><i class="bi bi-door-open-fill"></i> Door Check-in</span>'
        : (log.action === 'new_registration'
            ? '<span class="badge" style="background:#EFF6FF; color:#2563EB;"><i class="bi bi-person-plus-fill"></i> Walk-in Reg</span>'
            : '<span class="badge" style="background:#F1F5F9; color:#475569;"><i class="bi bi-box-arrow-in-right"></i> Login</span>');

      const name = log.registrants?.full_name || log.details?.names || log.details?.attendee_name || '—';
      const headcount = log.details?.pax ? `${log.details.pax} pax` : (log.details?.members ? `${log.details.members} pax` : '1 pax');
      const details = log.registrants?.church_affiliation || log.details?.church || log.details?.church_affiliation || 'General Fellowship';

      return `
        <tr>
          <td>${actionBadge}</td>
          <td style="font-weight: 600; color: #0F172A;">${escapeHtml(name)}</td>
          <td><span class="badge" style="background: #FEF3C7; color: #92400E; font-weight: 700;">${escapeHtml(headcount)}</span></td>
          <td style="color: #64748B; font-size: 0.88rem;">${escapeHtml(details)}</td>
          <td style="color: #64748B; font-size: 0.82rem;">${formatTime(log.created_at)}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.warn('Error loading usher activity log:', err);
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: #EF4444; padding: 16px;">Failed to load activity log.</td></tr>';
  }
}

