// ============================================================
// admin/users.js — Comprehensive Door Usher Account Management:
// - Multi-tier account creation (Edge Function -> Netlify Proxy -> Isolated Auth SignUp)
// - Enable / Disable account status toggle
// - Delete usher account with database cleanup
// - Secure password reset
// - Live door check-in activity audit log
// ============================================================

import { supabase } from '../config.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { showToast, formatDate, formatTime, escapeHtml } from '../utils.js';

export async function initUsers() {
  await loadUshers();
  await loadUsherActivityLog();

  const form = document.getElementById('add-usher-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = 'true';
    form.addEventListener('submit', handleCreate);

    // Wire password visibility toggles in the user management form
    form.querySelectorAll('.toggle-visibility').forEach((btn) => {
      btn.addEventListener('click', () => {
        const input = document.getElementById(btn.dataset.target);
        if (input) {
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          const icon = btn.querySelector('i');
          if (icon) {
            icon.className = isPassword ? 'bi bi-eye-slash-fill' : 'bi bi-eye-fill';
          }
        }
      });
    });
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

  if (error) {
    console.error('Error loading ushers:', error);
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #EF4444; padding: 24px;">Failed to load usher accounts. Please check database permissions.</td></tr>';
    return;
  }

  if (!data || data.length === 0) {
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
      <td>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn btn--outline btn--sm" data-toggle="${u.id}" data-active="${u.is_active}" title="Toggle active status">
            ${u.is_active ? '<i class="bi bi-pause-circle"></i> Disable' : '<i class="bi bi-play-circle"></i> Enable'}
          </button>
          <button class="btn btn--ghost btn--sm" data-reset="${u.id}" data-username="${escapeHtml(u.username)}" title="Reset password">
            <i class="bi bi-key"></i> Reset
          </button>
          <button class="btn btn--ghost btn--sm text-danger" data-delete="${u.id}" data-username="${escapeHtml(u.username)}" title="Delete usher account" style="color: #EF4444;">
            <i class="bi bi-trash3-fill"></i> Delete
          </button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleActive(btn.dataset.toggle, btn.dataset.active === 'true'));
  });
  tbody.querySelectorAll('[data-reset]').forEach((btn) => {
    btn.addEventListener('click', () => resetPassword(btn.dataset.reset, btn.dataset.username));
  });
  tbody.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => deleteUsher(btn.dataset.delete, btn.dataset.username));
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

  // Sanitize username: only lowercase letters, numbers, hyphens, and underscores
  const cleanUsername = rawUsername.replace(/[^a-z0-9_.-]/g, '');
  if (!cleanUsername) {
    showToast('Please enter a valid alphanumeric username.', 'error');
    return;
  }

  // Pre-check if username is already taken in profiles
  try {
    const { data: existing } = await supabase
      .from('profiles')
      .select('id, username')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (existing) {
      showToast(`An usher account with username "${cleanUsername}" already exists.`, 'error');
      return;
    }
  } catch (checkErr) {
    console.warn('Could not pre-check username:', checkErr);
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span> Creating Account…';
  }

  const usherEmail = `${cleanUsername}@usher.local`;
  let success = false;
  let errorMsg = null;

  // -------------------------------------------------------------
  // Tier 1: Try Supabase Edge Function create-usher (if deployed)
  // -------------------------------------------------------------
  try {
    const fnRes = await supabase.functions.invoke('create-usher', {
      body: { username: cleanUsername, password },
    });
    if (!fnRes.error && (fnRes.data?.ok || fnRes.data?.success)) {
      success = true;
    } else if (fnRes.error && !fnRes.error.message?.includes('not found') && !fnRes.error.message?.includes('404')) {
      errorMsg = fnRes.error.message;
    }
  } catch (fnErr) {
    console.warn('Edge Function create-usher not available, trying serverless/PHP proxies:', fnErr);
  }

  // -------------------------------------------------------------
  // Tier 2: Try Netlify Serverless Function or Local PHP proxy
  // -------------------------------------------------------------
  if (!success) {
    const proxyCandidates = [
      '/api/create-usher',
      '/.netlify/functions/create-usher',
      new URL('api-php/create-usher.php', window.location.href).href,
      '/conference-website/api-php/create-usher.php',
      new URL('api/create-usher.php', window.location.href).href,
      '/conference-website/api/create-usher.php',
    ];

    for (const proxyUrl of proxyCandidates) {
      try {
        const pRes = await fetch(proxyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: cleanUsername, password }),
        });
        if (pRes.status !== 404) {
          const json = await pRes.json().catch(() => null);
          if (pRes.ok && (json?.ok || json?.success)) {
            success = true;
            break;
          } else if (json?.error) {
            errorMsg = json.error;
          }
        }
      } catch (pErr) {
        console.warn('Proxy candidate failed:', pErr);
      }
    }
  }

  // -------------------------------------------------------------
  // Tier 3: Direct Isolated Supabase Auth Client Fallback
  // Uses an isolated Supabase client with persistSession: false so
  // the Admin session is completely untouched while creating the usher!
  // -------------------------------------------------------------
  if (!success) {
    try {
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');

      const isolatedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      });

      const { data: signUpData, error: signUpError } = await isolatedClient.auth.signUp({
        email: usherEmail,
        password: password,
      });

      if (signUpError) {
        if (signUpError.message?.toLowerCase().includes('already') || signUpError.status === 422) {
          errorMsg = `User "${cleanUsername}" already exists in authentication.`;
        } else {
          errorMsg = signUpError.message;
        }
      } else if (signUpData?.user?.id) {
        const newUserId = signUpData.user.id;

        // Insert matching profiles row using active Admin credentials
        const { error: profileError } = await supabase.from('profiles').upsert({
          id: newUserId,
          role: 'usher',
          username: cleanUsername,
          is_active: true,
          created_at: new Date().toISOString(),
        });

        if (profileError) {
          console.error('Failed to insert profiles row for usher:', profileError);
          errorMsg = profileError.message || 'Could not assign usher role in database.';
        } else {
          success = true;
        }
      }
    } catch (directErr) {
      console.error('Direct isolated signup failed:', directErr);
      errorMsg = errorMsg || directErr.message;
    }
  }

  if (success) {
    showToast(`Door usher account "${cleanUsername}" created successfully!`, 'success');
    e.target.reset();
    await loadUshers();
  } else {
    showToast(`Could not create usher: ${errorMsg || 'Please verify database permissions.'}`, 'error');
  }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="bi bi-person-check-fill"></i> <span>Create Usher Account</span>';
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

async function deleteUsher(id, username) {
  if (!confirm(`Are you sure you want to permanently delete door usher "${username}"?`)) {
    return;
  }

  try {
    // 1. Delete profile row
    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', id);

    if (profileError) throw profileError;

    // 2. Attempt auth deletion via proxy if available
    try {
      await fetch('/.netlify/functions/delete-usher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: id }),
      }).catch(() => null);
    } catch {}

    showToast(`Usher account "${username}" deleted successfully.`, 'success');
    await loadUshers();
  } catch (err) {
    console.error('Failed to delete usher:', err);
    showToast('Failed to delete usher account. Check database permissions.', 'error');
  }
}

async function resetPassword(id, username) {
  const newPassword = prompt(`Enter new password for usher "${username}" (minimum 6 characters):`);
  if (!newPassword || newPassword.length < 6) {
    if (newPassword !== null) {
      showToast('Password must be at least 6 characters.', 'error');
    }
    return;
  }

  let resetSuccess = false;
  let resetError = null;

  // 1. Try Supabase Edge Function
  try {
    const { data, error } = await supabase.functions.invoke('reset-usher-password', {
      body: { user_id: id, password: newPassword },
    });
    if (!error && (data?.ok || data?.success)) {
      resetSuccess = true;
    }
  } catch (e) {
    resetError = e.message;
  }

  // 2. Try Netlify Serverless or PHP proxy
  if (!resetSuccess) {
    const candidates = [
      '/.netlify/functions/reset-usher-password',
      new URL('api/reset-usher-password.php', window.location.href).href,
      '/conference-website/api/reset-usher-password.php',
    ];

    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: id, password: newPassword, username }),
        });
        if (res.status !== 404) {
          const json = await res.json().catch(() => null);
          if (res.ok && (json?.ok || json?.success)) {
            resetSuccess = true;
            break;
          }
        }
      } catch {}
    }
  }

  if (resetSuccess) {
    showToast(`Password for "${username}" updated successfully!`, 'success');
  } else {
    alert(`Password reset requires administrative Edge Functions.\n\nQuick alternative: You can delete the usher "${username}" and re-create it with the new password in 5 seconds!`);
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
