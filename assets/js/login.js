// ============================================================
// login.js — handles both the admin and usher login forms with
// loading states, feedback, and role switching.
// ============================================================

import { signIn, signInAsUsher, getCurrentProfile } from './auth.js';
import './utils.js';

init();

async function init() {
  // If already logged in, skip straight to the right dashboard.
  const profile = await getCurrentProfile();
  if (profile) redirectForRole(profile.role);

  setupTabs();
  setupPasswordToggles();
  document.getElementById('admin-login-form').addEventListener('submit', handleAdminLogin);
  document.getElementById('usher-login-form').addEventListener('submit', handleUsherLogin);
}

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const adminForm = document.getElementById('admin-login-form');
  const usherForm = document.getElementById('usher-login-form');
  const roleDesc = document.getElementById('role-description');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      tabs.forEach((t) => {
        t.classList.remove('tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('tab--active');
      tab.setAttribute('aria-selected', 'true');

      const role = tab.dataset.role;
      adminForm.hidden = role !== 'admin';
      usherForm.hidden = role !== 'usher';

      if (roleDesc) {
        roleDesc.textContent = role === 'admin'
          ? 'Full access to conference settings, SMS campaigns & database.'
          : 'Door check-in station for admitting registered attendees.';
      }

      hideError();
    });
  });
}

function setupPasswordToggles() {
  document.querySelectorAll('[data-toggle-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.toggleTarget);
      if (!input) return;
      const isPassword = input.type === 'password';
      input.type = isPassword ? 'text' : 'password';
      const icon = btn.querySelector('i');
      if (icon) {
        icon.className = isPassword ? 'bi bi-eye-slash-fill' : 'bi bi-eye-fill';
      }
    });
  });
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnHtml = submitBtn.innerHTML;

  const email = document.getElementById('admin-email').value.trim();
  const password = document.getElementById('admin-password').value;

  hideError();
  setBtnLoading(submitBtn, true, 'Signing in as Admin…');

  try {
    const { profile } = await signIn(email, password);
    if (profile.role !== 'admin') throw new Error('This account does not have administrator privileges.');
    redirectForRole('admin');
  } catch (err) {
    setBtnLoading(submitBtn, false, originalBtnHtml);
    showError(err.message ?? 'Sign in failed. Check your email and password.');
  }
}

async function handleUsherLogin(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = form.querySelector('button[type="submit"]');
  const originalBtnHtml = submitBtn.innerHTML;

  const username = document.getElementById('usher-username').value.trim();
  const password = document.getElementById('usher-password').value;

  hideError();
  setBtnLoading(submitBtn, true, 'Signing in as Usher…');

  try {
    const { profile } = await signInAsUsher(username, password);
    redirectForRole(profile.role);
  } catch (err) {
    setBtnLoading(submitBtn, false, originalBtnHtml);
    showError(err.message ?? 'Sign in failed. Check your username and password.');
  }
}

function setBtnLoading(btn, isLoading, content) {
  if (isLoading) {
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> <span>${content}</span>`;
  } else {
    btn.disabled = false;
    btn.innerHTML = content;
  }
}

function redirectForRole(role) {
  window.location.href = role === 'admin' ? './admin.html' : './usher.html';
}

function showError(message) {
  const el = document.getElementById('login-error');
  el.innerHTML = `<i class="bi bi-exclamation-triangle-fill"></i> <span>${message}</span>`;
  el.hidden = false;
}

function hideError() {
  const el = document.getElementById('login-error');
  el.hidden = true;
}
