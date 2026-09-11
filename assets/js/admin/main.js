// ============================================================
// admin/main.js — entry point for admin.html. Guards the route,
// wires up sidebar navigation, and lazily initializes each
// section's module the first time it's viewed.
// ============================================================

import { requireRole, signOut } from '../auth.js';
import '../utils.js';
import { initDashboard } from './dashboard.js';
import { initConferenceInfo } from './conference-info.js';
import { initSpeakers } from './speakers.js';
import { initRegistrants } from './registrants.js';
import { initInvite } from './invite.js';
import { initCampaigns } from './campaigns.js';
import { initGateway } from './gateway.js';
import { initUsers } from './users.js';

const moduleInitializers = {
  dashboard: initDashboard,
  'conference-info': initConferenceInfo,
  speakers: initSpeakers,
  registrants: initRegistrants,
  invite: initInvite,
  campaigns: initCampaigns,
  gateway: initGateway,
  users: initUsers,
};
const initialized = new Set();
const titles = {
  dashboard: 'Dashboard',
  'conference-info': 'Conference Info',
  speakers: 'Speakers',
  registrants: 'Registrants',
  invite: 'Invite Contacts',
  campaigns: 'SMS Campaigns',
  gateway: 'SMS Gateway',
  users: 'Manage Users',
};

init();

async function init() {
  const profile = await requireRole('admin');
  if (!profile) return;

  document.getElementById('logout-btn').addEventListener('click', signOut);

  document.querySelectorAll('.admin-nav__item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) {
        window.location.hash = view;
        switchView(view);
      }
    });
  });

  document.getElementById('mobile-menu-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.querySelector('.admin-sidebar').classList.toggle('admin-sidebar--open');
  });

  document.querySelector('.admin-main')?.addEventListener('click', () => {
    document.querySelector('.admin-sidebar')?.classList.remove('admin-sidebar--open');
  });

  // Setup universal modal backdrop dismiss and close 'X' buttons
  setupModals();

  // Listen to browser back/forward or hash changes
  window.addEventListener('hashchange', () => {
    const targetView = getInitialView();
    switchView(targetView);
  });

  // Determine initial view from URL hash or default to dashboard
  const initialView = getInitialView();
  await switchView(initialView);
}

function getInitialView() {
  const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return titles[hash] ? hash : 'dashboard';
}

function setupModals() {
  // Backdrop click dismiss for all dialog modals
  document.querySelectorAll('dialog.modal').forEach((dialog) => {
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const isInDialog = (
        rect.top <= e.clientY &&
        e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX &&
        e.clientX <= rect.left + rect.width
      );
      if (!isInDialog) {
        dialog.close();
      }
    });
  });

  // Universal close 'X' button support inside any modal
  document.querySelectorAll('.modal__close-btn, #speaker-close-x, #confirm-send-close-x, #manual-register-close-x').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dialog = btn.closest('dialog');
      if (dialog) dialog.close();
    });
  });
}

async function switchView(view) {
  if (!titles[view]) view = 'dashboard';

  document.querySelectorAll('.admin-nav__item[data-view]').forEach((b) => {
    b.classList.toggle('admin-nav__item--active', b.dataset.view === view);
  });
  document.querySelectorAll('.admin-view').forEach((section) => {
    section.classList.toggle('admin-view--active', section.id === `view-${view}`);
  });
  document.getElementById('mobile-title').textContent = titles[view] ?? '';
  document.querySelector('.admin-sidebar')?.classList.remove('admin-sidebar--open');

  if (view === 'dashboard' && initialized.has('dashboard')) {
    moduleInitializers.dashboard?.();
  } else {
    await ensureInitialized(view);
  }
}

async function ensureInitialized(view) {
  if (initialized.has(view)) return;
  initialized.add(view);
  try {
    await moduleInitializers[view]?.();
  } catch (err) {
    console.error(`Failed to initialize "${view}" view`, err);
  }
}

