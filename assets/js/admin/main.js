// ============================================================
// admin/main.js — Modern, resilient entry point for admin.html.
// - Flicker-free app shell preloader with smooth transition
// - Secure auth route guard with timeout safety
// - Desktop executive header bar with live system status
// - Accessible mobile drawer with backdrop overlay & ARIA states
// - Resilient view switching with error boundaries & auto-scroll
// ============================================================

import { requireRole, signOut } from '../auth.js';
import '../utils.js';
import { initDashboard } from './dashboard.js';
import { initConferenceInfo } from './conference-info.js';
import { initSpeakers } from './speakers.js';
import { initRegistrants } from './registrants.js';
import { initInvite, initContactsDirectory, loadContactsDirectory, loadBatches } from './invite.js';
import { initCampaigns } from './campaigns.js';
import { initGateway } from './gateway.js';
import { initUsers } from './users.js';

const moduleInitializers = {
  dashboard: initDashboard,
  'conference-info': initConferenceInfo,
  speakers: initSpeakers,
  registrants: initRegistrants,
  invite: initInvite,
  contacts: initContactsDirectory,
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
  contacts: 'Invited Contacts',
  campaigns: 'SMS Campaigns',
  gateway: 'SMS Gateway',
  users: 'Manage Users',
};

let closeMobileDrawerFn = null;

// Global error boundary to catch unhandled errors smoothly
window.addEventListener('unhandledrejection', (event) => {
  console.warn('Admin runtime warning:', event.reason);
});

init();

async function init() {
  try {
    updatePreloaderStatus('Verifying administrative access…');

    // 1. Session verification with timeout guard (8s)
    const authPromise = requireRole('admin');
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Authentication check timed out. Please verify your connection.')), 8000)
    );

    const profile = await Promise.race([authPromise, timeoutPromise]);
    if (!profile) {
      // requireRole redirects unauthenticated sessions to login.html
      return;
    }

    // 2. Populate executive top bar
    populateAdminHeader(profile);

    // 3. Setup core interactive layers
    document.getElementById('logout-btn')?.addEventListener('click', signOut);
    bindNavigation();
    setupModals();
    const { closeDrawer } = setupMobileDrawer();
    closeMobileDrawerFn = closeDrawer;

    // 4. Listen to browser back/forward or hash changes
    window.addEventListener('hashchange', () => {
      const targetView = getInitialView();
      switchView(targetView);
    });

    // 5. Determine initial view from URL hash or default to dashboard
    const initialView = getInitialView();
    updatePreloaderStatus(`Loading ${titles[initialView] || 'Console'}…`);
    await switchView(initialView);

    // 6. Smoothly fade out preloader
    hidePreloader();
  } catch (err) {
    console.error('Fatal initialization error in admin portal:', err);
    showPreloaderError(err.message || 'Could not verify administrative session.');
  }
}

function getInitialView() {
  const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return titles[hash] ? hash : 'dashboard';
}

function updatePreloaderStatus(text) {
  const el = document.getElementById('admin-app-loader-status');
  if (el) el.textContent = text;
}

function hidePreloader() {
  const loader = document.getElementById('admin-app-loader');
  if (!loader) return;
  loader.classList.add('admin-app-loader--hidden');
  setTimeout(() => {
    loader.style.display = 'none';
  }, 400);
}

function showPreloaderError(message) {
  const el = document.getElementById('admin-app-loader-status');
  if (el) {
    el.innerHTML = `
      <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #EF4444; border-radius: 12px; padding: 14px 18px; margin-top: 10px;">
        <div style="color: #FCA5A5; font-weight: 600; font-size: 0.9rem; margin-bottom: 8px;">
          ${message}
        </div>
        <a href="#" onclick="location.reload(); return false;" style="color: #38BDF8; font-weight: 700; text-decoration: underline; font-size: 0.88rem;">
          <i class="bi bi-arrow-clockwise"></i> Tap to Reload Console
        </a>
      </div>
    `;
  }
}

function populateAdminHeader(profile) {
  const displayEl = document.getElementById('admin-user-display');
  if (displayEl) {
    const username = profile?.username || profile?.email?.split('@')[0] || 'Administrator';
    displayEl.textContent = username;
  }

  const dateEl = document.getElementById('admin-header-date');
  if (dateEl) {
    try {
      dateEl.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date());
    } catch {
      dateEl.textContent = new Date().toDateString();
    }
  }
}

function bindNavigation() {
  document.querySelectorAll('.admin-nav__item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      if (view) {
        window.location.hash = view;
        switchView(view);
      }
    });
  });
}

function setupMobileDrawer() {
  const sidebar = document.getElementById('admin-sidebar') || document.querySelector('.admin-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  const menuBtn = document.getElementById('mobile-menu-btn');

  const openDrawer = () => {
    sidebar?.classList.add('admin-sidebar--open');
    backdrop?.classList.add('admin-sidebar-backdrop--visible');
    menuBtn?.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  };

  const closeDrawer = () => {
    sidebar?.classList.remove('admin-sidebar--open');
    backdrop?.classList.remove('admin-sidebar-backdrop--visible');
    menuBtn?.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
  };

  menuBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = sidebar?.classList.contains('admin-sidebar--open');
    if (isOpen) closeDrawer();
    else openDrawer();
  });

  backdrop?.addEventListener('click', closeDrawer);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar?.classList.contains('admin-sidebar--open')) {
      closeDrawer();
    }
  });

  return { openDrawer, closeDrawer };
}

function setupModals() {
  // Universal backdrop click dismiss for dialog modals
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

  // Dismiss mobile drawer immediately on view change
  closeMobileDrawerFn?.();

  // Update navigation items with ARIA states
  document.querySelectorAll('.admin-nav__item[data-view]').forEach((b) => {
    const isActive = b.dataset.view === view;
    b.classList.toggle('admin-nav__item--active', isActive);
    if (isActive) {
      b.setAttribute('aria-current', 'page');
    } else {
      b.removeAttribute('aria-current');
    }
  });

  // Toggle active view panel
  document.querySelectorAll('.admin-view').forEach((section) => {
    section.classList.toggle('admin-view--active', section.id === `view-${view}`);
  });

  const mobileTitle = document.getElementById('mobile-title');
  if (mobileTitle) mobileTitle.textContent = titles[view] ?? '';

  // Smooth scroll to top for comfortable view transition
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Re-run fresh data updates or lazy initialize
  if (view === 'dashboard' && initialized.has('dashboard')) {
    moduleInitializers.dashboard?.();
  } else if (view === 'contacts' && initialized.has('contacts')) {
    loadContactsDirectory?.();
    loadBatches?.();
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
    console.error(`Failed to initialize "${view}" view:`, err);
    renderViewError(view, err.message);
  }
}

function renderViewError(view, message) {
  const section = document.getElementById(`view-${view}`);
  if (!section) return;

  const errorNotice = document.createElement('div');
  errorNotice.className = 'panel';
  errorNotice.style.cssText = 'background: #FEF2F2; border: 1.5px solid #FCA5A5; text-align: center; padding: 32px 20px; margin-bottom: 24px; border-radius: 14px;';
  errorNotice.innerHTML = `
    <i class="bi bi-exclamation-circle-fill text-danger" style="font-size: 2.2rem; display: block; margin-bottom: 12px;"></i>
    <h3 style="color: #991B1B; margin: 0 0 8px; font-size: 1.15rem;">Unable to load ${titles[view] || 'this section'}</h3>
    <p style="color: #7F1D1D; font-size: 0.88rem; max-width: 480px; margin: 0 auto 16px;">
      ${message || 'A network error occurred while connecting to the database.'}
    </p>
    <button type="button" class="btn btn--primary btn--sm" onclick="location.reload();">
      <i class="bi bi-arrow-clockwise"></i> Retry
    </button>
  `;
  section.prepend(errorNotice);
}
