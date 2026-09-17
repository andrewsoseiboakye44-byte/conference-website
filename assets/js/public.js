// ============================================================
// public.js — enhanced logic for the public registration portal.
// Dynamic CMS loading, interactive category switching, real-time
// validation, and confirmation pass preview.
// ============================================================

import { supabase } from './config.js';
import { formatPhoneNumber, isValidPhoneNumber, showToast, escapeHtml, formatDate } from './utils.js';
import { sendRegistrationConfirmationSms } from './sms.js';

let currentCategory = 'person';

init();

async function init() {
  const footerYear = document.getElementById('footer-year');
  if (footerYear) footerYear.textContent = new Date().getFullYear();

  await loadConferenceSettings();
  await loadSpeakers();
  setupTabs();
  setupPhoneFormatting();
  setupForm();
}

// ---------- CMS content ----------

async function loadConferenceSettings() {
  // 1. Immediately apply cached settings from localStorage (0ms instant display, no flicker!)
  try {
    const cached = localStorage.getItem('cached_conference_settings');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed) applyConferenceSettings(parsed);
    }
  } catch { /* ignore */ }

  // 2. Fetch fresh settings from database
  try {
    const { data, error } = await supabase
      .from('conference_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('Could not load conference settings', error);
      return;
    }

    if (data) {
      try {
        localStorage.setItem('cached_conference_settings', JSON.stringify(data));
      } catch { /* ignore */ }
      applyConferenceSettings(data);
    }
  } catch (err) {
    console.error('Exception loading conference settings', err);
  }
}

function applyConferenceSettings(data) {
  if (!data) return;

  const nameEl = document.getElementById('hero-name');
  if (nameEl) {
    nameEl.textContent = data.conference_name || '';
  }

  const themeEl = document.getElementById('hero-theme');
  if (themeEl) {
    if (data.theme_scripture && data.theme_scripture.trim()) {
      themeEl.textContent = data.theme_scripture.trim();
      themeEl.style.display = 'block';
    } else {
      themeEl.style.display = 'none';
    }
  }

  const eyebrowEl = document.getElementById('hero-eyebrow');
  const dates = document.getElementById('hero-dates');
  if (dates) {
    let cleanTime = '';
    if (data.daily_time) {
      if (typeof data.daily_time === 'string' && data.daily_time.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(data.daily_time);
          if (parsed.summary && typeof parsed.summary === 'string') {
            cleanTime = parsed.summary.trim();
          }
        } catch {
          cleanTime = '';
        }
      } else {
        cleanTime = String(data.daily_time).trim();
      }
    }

    let dateText = '';
    if (data.start_date && data.end_date) {
      const opts = { day: 'numeric', month: 'short', year: 'numeric' };
      const start = new Date(data.start_date).toLocaleDateString('en-GB', opts);
      const end = new Date(data.end_date).toLocaleDateString('en-GB', opts);
      dateText = cleanTime ? `${start} – ${end} · ${cleanTime}` : `${start} – ${end}`;
    } else if (data.start_date) {
      const opts = { day: 'numeric', month: 'short', year: 'numeric' };
      const start = new Date(data.start_date).toLocaleDateString('en-GB', opts);
      dateText = cleanTime ? `Starts ${start} · ${cleanTime}` : `Starts ${start}`;
    } else if (cleanTime) {
      dateText = cleanTime;
    }

    if (dateText) {
      dates.textContent = dateText;
      if (eyebrowEl) eyebrowEl.style.display = 'inline-flex';
    } else {
      if (eyebrowEl) eyebrowEl.style.display = 'none';
    }
  }

  const metaEl = document.getElementById('hero-meta');
  const venueWrap = document.getElementById('hero-venue-wrap');
  const venueEl = document.getElementById('hero-venue');
  if (venueEl) {
    if (data.venue && data.venue.trim()) {
      venueEl.textContent = data.venue.trim();
      if (venueWrap) venueWrap.style.display = 'inline-flex';
      if (metaEl) metaEl.style.display = 'flex';
    } else {
      if (venueWrap) venueWrap.style.display = 'none';
      if (metaEl) metaEl.style.display = 'none';
    }
  }

  const aboutSection = document.getElementById('about');
  const descEl = document.getElementById('about-description');
  if (descEl) {
    if (data.description && data.description.trim()) {
      descEl.textContent = data.description.trim();
      if (aboutSection) aboutSection.style.display = '';
    } else {
      if (aboutSection) aboutSection.style.display = 'none';
    }
  }

  if (data.flyer_image_url) {
    const heroEl = document.getElementById('hero');
    if (heroEl) {
      heroEl.style.setProperty(
        'background-image',
        `linear-gradient(150deg, rgba(11, 19, 41, 0.92) 0%, rgba(30, 58, 138, 0.88) 100%), url(${data.flyer_image_url})`
      );
      heroEl.style.backgroundSize = 'cover';
      heroEl.style.backgroundPosition = 'center';
    }
  }

  // Parse multi-day schedule
  let scheduleList = null;
  if (Array.isArray(data.schedule) && data.schedule.length > 0) {
    scheduleList = data.schedule;
  } else if (typeof data.schedule === 'string' && data.schedule.startsWith('[')) {
    try { scheduleList = JSON.parse(data.schedule); } catch { /* ignore */ }
  } else if (typeof data.daily_time === 'string' && data.daily_time.startsWith('{')) {
    try {
      const parsed = JSON.parse(data.daily_time);
      if (Array.isArray(parsed.schedule)) {
        scheduleList = parsed.schedule;
      }
    } catch { /* ignore */ }
  }

  renderPublicSchedule(scheduleList, data);
  renderPublicDonation(data);
  renderRegistrationAccess(data);
}

let isRegistrationLocked = false;

function renderRegistrationAccess(data) {
  if (!data) return;

  let regFallback = {};
  if (typeof data.daily_time === 'string' && data.daily_time.startsWith('{')) {
    try {
      const parsed = JSON.parse(data.daily_time);
      if (parsed.registration) regFallback = parsed.registration;
    } catch { /* ignore */ }
  }

  // Determine status setting ('open', 'closed', 'auto')
  let statusSetting = 'open';
  if (data.is_registration_open === false || regFallback.is_open === false || regFallback.status === 'closed') {
    statusSetting = 'closed';
  } else if (regFallback.status === 'auto' || (data.is_registration_open === null && (data.registration_start_date || regFallback.start_date))) {
    statusSetting = 'auto';
  } else if (regFallback.status) {
    statusSetting = regFallback.status;
  }

  const startDate = data.registration_start_date || regFallback.start_date || null;
  const endDate = data.registration_end_date || regFallback.end_date || null;
  const customMessage = data.registration_closed_message || regFallback.closed_message || '';
  const confName = data.conference_name || 'Annual Conference';

  const todayStr = new Date().toISOString().split('T')[0];

  let locked = false;
  let lockReason = ''; // 'upcoming' | 'ended' | 'closed'

  if (statusSetting === 'closed') {
    locked = true;
    lockReason = 'closed';
  } else if (statusSetting === 'auto') {
    if (startDate && todayStr < startDate) {
      locked = true;
      lockReason = 'upcoming';
    } else if (endDate && todayStr > endDate) {
      locked = true;
      lockReason = 'ended';
    }
  } else if (statusSetting === 'open') {
    if (endDate && todayStr > endDate) {
      locked = true;
      lockReason = 'ended';
    }
  }

  isRegistrationLocked = locked;

  const banner = document.getElementById('reg-status-banner');
  const badge = document.getElementById('reg-status-banner-badge');
  const badgeText = document.getElementById('reg-status-badge-text');
  const title = document.getElementById('reg-status-banner-title');
  const message = document.getElementById('reg-status-banner-message');
  const datesWrap = document.getElementById('reg-status-banner-dates');
  const dateText = document.getElementById('reg-status-banner-datetext');
  const regCard = document.querySelector('.reg-card');
  const form = document.getElementById('registration-form');
  const submitBtn = document.getElementById('submit-btn');

  if (locked) {
    if (banner) {
      banner.hidden = false;
      if (badge) {
        badge.className = 'reg-status-banner__badge';
        if (lockReason === 'closed') badge.classList.add('badge--closed');
        if (lockReason === 'ended') badge.classList.add('badge--ended');
      }

      if (lockReason === 'upcoming') {
        if (badgeText) badgeText.textContent = 'Registration Opens Soon';
        if (title) title.textContent = `${confName} Registration Opens Soon`;
        if (message) {
          message.textContent = customMessage || `Public registration for ${confName} is opening soon! You can review the program schedule, speakers, and venue details below. The registration form will unlock as soon as registration opens.`;
        }
        if (datesWrap && dateText) {
          if (startDate) {
            datesWrap.style.display = 'inline-flex';
            dateText.textContent = `Registration officially opens: ${formatDate(startDate)}`;
          } else {
            datesWrap.style.display = 'none';
          }
        }
      } else if (lockReason === 'ended') {
        if (badgeText) badgeText.textContent = 'Registration Closed';
        if (title) title.textContent = `${confName} Registration Has Concluded`;
        if (message) {
          message.textContent = customMessage || `Registration for ${confName} is now closed. Thank you for your interest!`;
        }
        if (datesWrap) datesWrap.style.display = 'none';
      } else {
        // Closed / Paused
        if (badgeText) badgeText.textContent = 'Registration Opening Soon';
        if (title) title.textContent = `Registration Notice for ${confName}`;
        if (message) {
          message.textContent = customMessage || `Registration is not yet open at this time. All conference information, speakers, and session schedule remain open for you to read below!`;
        }
        if (datesWrap && dateText) {
          if (startDate) {
            datesWrap.style.display = 'inline-flex';
            dateText.textContent = `Registration scheduled date: ${formatDate(startDate)}`;
          } else {
            datesWrap.style.display = 'none';
          }
        }
      }
    }

    // Update top nav & hero CTA buttons to guide visitors smoothly
    const navCtaText = document.getElementById('nav-cta-text');
    const navCtaIcon = document.getElementById('nav-cta-icon');
    const heroCtaText = document.getElementById('hero-cta-text');
    const heroCtaIcon = document.getElementById('hero-cta-icon');

    if (navCtaText) navCtaText.textContent = 'Conference Info';
    if (navCtaIcon) navCtaIcon.className = 'bi bi-info-circle-fill';
    if (heroCtaText) heroCtaText.textContent = 'View Conference Details & Schedule';
    if (heroCtaIcon) heroCtaIcon.className = 'bi bi-calendar-check-fill';

    // Lock the form inputs
    if (regCard) regCard.classList.add('reg-card--locked');
    if (form) {
      form.querySelectorAll('input, select, textarea').forEach((el) => {
        el.disabled = true;
      });
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <i class="bi bi-lock-fill"></i>
        <span>${lockReason === 'ended' ? 'Registration Closed' : 'Registration Opens Soon'}</span>
      `;
    }
  } else {
    // Unlocked / Open
    if (banner) banner.hidden = true;
    if (regCard) regCard.classList.remove('reg-card--locked');
    if (form) {
      form.querySelectorAll('input, select, textarea').forEach((el) => {
        el.disabled = false;
      });
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `
        <span>Complete Free Registration</span>
        <i class="bi bi-arrow-right-circle-fill"></i>
      `;
    }

    const navCtaText = document.getElementById('nav-cta-text');
    const navCtaIcon = document.getElementById('nav-cta-icon');
    const heroCtaText = document.getElementById('hero-cta-text');
    const heroCtaIcon = document.getElementById('hero-cta-icon');

    if (navCtaText) navCtaText.textContent = 'Register Now';
    if (navCtaIcon) navCtaIcon.className = 'bi bi-ticket-perforated-fill';
    if (heroCtaText) heroCtaText.textContent = 'Register to Attend';
    if (heroCtaIcon) heroCtaIcon.className = 'bi bi-ticket-perforated-fill';
  }
}

function renderPublicSchedule(scheduleList, confData) {
  const scheduleSection = document.getElementById('schedule');
  const tabsContainer = document.getElementById('schedule-days-tabs');
  const contentContainer = document.getElementById('schedule-content');
  if (!tabsContainer || !contentContainer) return;

  const hasSchedule = Array.isArray(scheduleList) && scheduleList.length > 0;
  const hasDailyTime = !!(confData?.daily_time && (typeof confData.daily_time !== 'string' || confData.daily_time.trim()));

  if (!hasSchedule && !hasDailyTime) {
    if (scheduleSection) scheduleSection.style.display = 'none';
    return;
  }
  if (scheduleSection) scheduleSection.style.display = '';

  // If no structured multi-day schedule, provide clean daily time display
  if (!hasSchedule) {
    let summaryTime = '';
    if (confData?.daily_time) {
      if (typeof confData.daily_time === 'string' && confData.daily_time.startsWith('{')) {
        try {
          const parsed = JSON.parse(confData.daily_time);
          if (parsed.summary && typeof parsed.summary === 'string' && parsed.summary.trim()) {
            summaryTime = parsed.summary.trim();
          }
        } catch { /* ignore */ }
      } else if (typeof confData.daily_time === 'string' && confData.daily_time.trim()) {
        summaryTime = confData.daily_time.trim();
      }
    }
    const venue = confData?.venue || '';

    tabsContainer.innerHTML = '';
    contentContainer.innerHTML = `
      <div class="schedule-active-day-banner">
        <h3><i class="bi bi-clock-history text-primary"></i> Program Schedule</h3>
        ${summaryTime ? `
          <span class="badge" style="background: #EFF6FF; color: #2563EB; font-weight: 700; padding: 4px 10px; border-radius: 999px;">
            ${escapeHtml(summaryTime)}
          </span>
        ` : ''}
      </div>
      <div class="schedule-sessions-grid">
        <div class="schedule-session-card">
          <div class="session-time-col">
            ${summaryTime ? `
              <span class="session-time-badge">
                <i class="bi bi-clock-fill"></i> ${escapeHtml(summaryTime)}
              </span>
            ` : ''}
            ${venue ? `
              <span class="session-venue-badge">
                <i class="bi bi-geo-alt-fill"></i> ${escapeHtml(venue)}
              </span>
            ` : ''}
          </div>
          <div class="session-info-col">
            <h4>${escapeHtml(confData?.conference_name || 'General Session')}</h4>
            <p class="session-desc">Welcome to our conference sessions. Register to reserve your seat!</p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  let activeDayIndex = 0;

  function renderDayTabs() {
    tabsContainer.innerHTML = scheduleList.map((day, idx) => {
      const isActive = idx === activeDayIndex;
      let dateLabel = '';
      if (day.date) {
        try {
          const d = new Date(day.date);
          dateLabel = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
        } catch {
          dateLabel = day.date;
        }
      }

      return `
        <div class="schedule-day-tab ${isActive ? 'schedule-day-tab--active' : ''}" 
             role="tab" 
             tabindex="0" 
             aria-selected="${isActive}" 
             data-day-index="${idx}">
          <span class="schedule-day-tab__title">${escapeHtml(day.day_title || `Day ${idx + 1}`)}</span>
          ${dateLabel ? `<span class="schedule-day-tab__date">${escapeHtml(dateLabel)}</span>` : ''}
        </div>
      `;
    }).join('');

    // Attach tab click and keyboard events
    tabsContainer.querySelectorAll('.schedule-day-tab').forEach((tab) => {
      const selectTab = () => {
        const targetIdx = parseInt(tab.dataset.dayIndex, 10);
        if (targetIdx !== activeDayIndex) {
          activeDayIndex = targetIdx;
          renderDayTabs();
          renderDayContent(scheduleList[activeDayIndex]);
        }
      };

      tab.addEventListener('click', selectTab);
      tab.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          selectTab();
        }
      });
    });
  }

  function renderDayContent(day) {
    if (!day) return;

    let fullDateText = '';
    if (day.date) {
      try {
        fullDateText = formatDate(day.date);
      } catch {
        fullDateText = day.date;
      }
    }

    const sessions = Array.isArray(day.sessions) && day.sessions.length > 0 
      ? day.sessions 
      : [{
          time: '6:00 PM - 9:00 PM',
          title: `${day.day_title || 'Day'} General Session`,
          speaker: '',
          venue: confData?.venue || 'Main Auditorium',
          description: 'Praise, keynote ministrations, and divine encounters.',
        }];

    contentContainer.innerHTML = `
      <div class="schedule-active-day-banner">
        <div>
          <h3>
            <i class="bi bi-calendar2-check-fill text-primary"></i>
            <span>${escapeHtml(day.day_title || 'Conference Program')}</span>
          </h3>
          ${day.theme ? `
            <div style="font-size: 0.92rem; color: #2563EB; font-weight: 600; margin-top: 4px;">
              “${escapeHtml(day.theme)}”
            </div>
          ` : ''}
        </div>

        ${fullDateText ? `
          <span class="badge" style="background: #EFF6FF; color: #1D4ED8; font-weight: 700; border: 1px solid #BFDBFE; padding: 6px 14px; border-radius: 999px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px;">
            <i class="bi bi-calendar-event"></i>
            <span>${escapeHtml(fullDateText)}</span>
          </span>
        ` : ''}
      </div>

      <div class="schedule-sessions-grid">
        ${sessions.map((sess) => `
          <div class="schedule-session-card">
            <div class="session-time-col">
              <span class="session-time-badge">
                <i class="bi bi-clock-fill"></i>
                <span>${escapeHtml(sess.time || 'Schedule Time')}</span>
              </span>
              ${sess.venue ? `
                <span class="session-venue-badge">
                  <i class="bi bi-geo-alt-fill"></i>
                  <span>${escapeHtml(sess.venue)}</span>
                </span>
              ` : ''}
            </div>
            <div class="session-info-col">
              <h4>${escapeHtml(sess.title || 'Conference Session')}</h4>
              ${sess.speaker ? `
                <div>
                  <span class="session-speaker-tag">
                    <i class="bi bi-person-badge-fill"></i>
                    <span>${escapeHtml(sess.speaker)}</span>
                  </span>
                </div>
              ` : ''}
              ${sess.description ? `
                <p class="session-desc">${escapeHtml(sess.description)}</p>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Initial render
  renderDayTabs();
  renderDayContent(scheduleList[0]);
}

function renderPublicDonation(data) {
  let momoData = {
    number: data?.momo_number || '',
    network: data?.momo_network || 'MTN',
    account_name: data?.momo_account_name || '',
    title: data?.donation_title || 'Support This Conference',
    note: data?.donation_note || '',
  };

  // Fallback if DB columns haven't been migrated yet and data is packed in daily_time
  if (!momoData.number && typeof data?.daily_time === 'string' && data.daily_time.startsWith('{')) {
    try {
      const parsed = JSON.parse(data.daily_time);
      if (parsed.momo && parsed.momo.number) {
        momoData = { ...momoData, ...parsed.momo };
      }
    } catch { /* ignore */ }
  }

  const donorCard = document.getElementById('donor-support-card');
  const passMomoCard = document.getElementById('pass-momo-card');

  if (!momoData.number || !momoData.number.trim()) {
    if (donorCard) donorCard.hidden = true;
    if (passMomoCard) passMomoCard.hidden = true;
    return;
  }

  const cleanNumber = momoData.number.trim();
  const cleanNetwork = momoData.network?.trim() || 'MTN';
  const cleanName = momoData.account_name?.trim() || '';
  const cleanTitle = momoData.title?.trim() || 'Support This Conference';
  const cleanNote = momoData.note?.trim() || '';

  const networkLabels = {
    'MTN': 'MTN MoMo',
    'Telecel': 'Telecel Cash',
    'AT': 'AT Money',
    'All': 'All Networks / MoMo'
  };
  const networkLabel = networkLabels[cleanNetwork] || `${cleanNetwork} MoMo`;

  // 1. Populate Registration Form Card
  if (donorCard) {
    const titleEl = document.getElementById('donor-support-title');
    if (titleEl) titleEl.textContent = cleanTitle;

    const netEl = document.getElementById('donor-momo-network');
    if (netEl) {
      netEl.textContent = networkLabel;
      netEl.setAttribute('data-network', cleanNetwork.toLowerCase());
    }

    const nameEl = document.getElementById('donor-momo-name');
    if (nameEl) nameEl.textContent = cleanName ? `(${cleanName})` : '';

    const numEl = document.getElementById('donor-momo-number');
    if (numEl) numEl.textContent = cleanNumber;

    const noteEl = document.getElementById('donor-momo-note');
    const noteWrap = document.getElementById('donor-momo-note-wrap');
    if (noteEl && noteWrap) {
      if (cleanNote) {
        noteEl.textContent = cleanNote;
        noteWrap.style.display = 'flex';
      } else {
        noteWrap.style.display = 'none';
      }
    }

    const copyBtn = document.getElementById('btn-copy-momo');
    if (copyBtn && !copyBtn.dataset.bound) {
      copyBtn.dataset.bound = 'true';
      copyBtn.addEventListener('click', () => {
        const rawNum = cleanNumber.replace(/\s+/g, '');
        navigator.clipboard.writeText(rawNum).then(() => {
          const originalHtml = copyBtn.innerHTML;
          copyBtn.innerHTML = '<i class="bi bi-check2-circle"></i> <span>Copied!</span>';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.innerHTML = originalHtml;
            copyBtn.classList.remove('copied');
          }, 2000);
        }).catch(() => {
          prompt('Copy Mobile Money Number:', cleanNumber);
        });
      });
    }

    donorCard.hidden = false;
  }

  // 2. Populate Digital Pass MoMo Widget
  if (passMomoCard) {
    const passNetEl = document.getElementById('pass-momo-net');
    if (passNetEl) passNetEl.textContent = cleanNetwork;

    const passNumEl = document.getElementById('pass-momo-num');
    if (passNumEl) passNumEl.textContent = cleanNumber;

    const passNameEl = document.getElementById('pass-momo-name');
    if (passNameEl) passNameEl.textContent = cleanName ? `(${cleanName})` : '';

    const passCopyBtn = document.getElementById('btn-copy-pass-momo');
    if (passCopyBtn && !passCopyBtn.dataset.bound) {
      passCopyBtn.dataset.bound = 'true';
      passCopyBtn.addEventListener('click', () => {
        const rawNum = cleanNumber.replace(/\s+/g, '');
        navigator.clipboard.writeText(rawNum).then(() => {
          const originalHtml = passCopyBtn.innerHTML;
          passCopyBtn.innerHTML = '<i class="bi bi-check2-circle"></i> <span>Copied!</span>';
          setTimeout(() => {
            passCopyBtn.innerHTML = originalHtml;
          }, 2000);
        }).catch(() => {
          prompt('Copy Mobile Money Number:', cleanNumber);
        });
      });
    }

    passMomoCard.hidden = false;
  }
}

async function loadSpeakers() {
  const { data, error } = await supabase
    .from('speakers')
    .select('*')
    .order('display_order', { ascending: true });

  const grid = document.getElementById('speakers-grid');
  if (!grid) return;

  if (error || !data || data.length === 0) {
    const speakersSection = document.getElementById('speakers');
    if (speakersSection) speakersSection.hidden = true;
    return;
  }

  grid.innerHTML = data.map((speaker) => `
    <article class="speaker-card">
      <img class="speaker-card__photo" src="${escapeHtml(speaker.photo_url || 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400&auto=format&fit=crop&q=80')}" alt="${escapeHtml(speaker.name)}" loading="lazy" />
      <h3 class="speaker-card__name">${escapeHtml(speaker.name)}</h3>
      <p class="speaker-card__title">${escapeHtml(speaker.title ?? '')}</p>
      <p class="speaker-card__bio">${escapeHtml(speaker.bio ?? '')}</p>
    </article>
  `).join('');
}

// ---------- Category tabs ----------

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const catInput = document.getElementById('category');

  tabs.forEach((tab) => {
    const selectTab = () => {
      tabs.forEach((t) => {
        t.classList.remove('tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('tab--active');
      tab.setAttribute('aria-selected', 'true');

      currentCategory = tab.dataset.category;
      if (catInput) catInput.value = currentCategory;

      document.querySelectorAll('.reg-form__group').forEach((group) => {
        group.hidden = group.dataset.group !== currentCategory;
      });

      // Update form header title
      const categoryTitle = document.getElementById('active-category-title');
      const categorySubtitle = document.getElementById('active-category-subtitle');
      if (categoryTitle && categorySubtitle) {
        if (currentCategory === 'person') {
          categoryTitle.textContent = 'Individual & Family Registration';
          categorySubtitle.textContent = 'Register for yourself, your family, or a small personal group.';
        } else if (currentCategory === 'institution') {
          categoryTitle.textContent = 'Institution & Organization Registration';
          categorySubtitle.textContent = 'Register on behalf of an academic, ministry, or corporate body.';
        } else if (currentCategory === 'church') {
          categoryTitle.textContent = 'Visiting Church Delegation';
          categorySubtitle.textContent = 'Register an official delegation from a partner or invited church.';
        }
      }
    };

    tab.addEventListener('click', selectTab);
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectTab();
      }
    });
  });
}

function setupPhoneFormatting() {
  document.querySelectorAll('input[name="contact_phone"]').forEach((phoneInput) => {
    phoneInput.addEventListener('input', (e) => {
      const raw = e.target.value;
      const field = e.target.closest('.field');
      if (raw.length > 8) {
        const formatted = formatPhoneNumber(raw);
        if (isValidPhoneNumber(formatted)) {
          field?.classList.remove('has-error');
        }
      }
    });
  });
}

// ---------- Form submission ----------

function setupForm() {
  const form = document.getElementById('registration-form');
  if (form) form.addEventListener('submit', handleSubmit);

  const resetBtn = document.getElementById('btn-register-another');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (form) {
        form.reset();
        form.hidden = false;
      }
      const tabsContainer = document.querySelector('.reg-category-grid');
      if (tabsContainer) tabsContainer.hidden = false;

      const successEl = document.getElementById('reg-success');
      if (successEl) successEl.hidden = true;

      const regSection = document.getElementById('register');
      if (regSection) regSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  if (isRegistrationLocked) {
    showToast('Registration is not currently open. Please review the conference schedule and details.', 'info');
    return;
  }
  const form = e.target;
  const submitBtn = document.getElementById('submit-btn');
  const originalBtnHtml = submitBtn.innerHTML;

  const activeGroup = form.querySelector(`.reg-form__group[data-group="${currentCategory}"]`);
  const getField = (name) => activeGroup.querySelector(`[name="${name}"]`);

  clearErrors(activeGroup);

  const fullName = getField('full_name')?.value.trim();
  const phoneRaw = getField('contact_phone')?.value.trim();
  const phone = formatPhoneNumber(phoneRaw);

  let hasError = false;
  if (!fullName) {
    setFieldError(getField('full_name'), 'Please enter your full name');
    hasError = true;
  }
  if (!isValidPhoneNumber(phone)) {
    setFieldError(getField('contact_phone'), 'Please enter a valid phone number (e.g. 024 123 4567)');
    hasError = true;
  }
  if (hasError) return;

  const payload = {
    category: currentCategory,
    full_name: fullName,
    location: getField('location')?.value.trim() || null,
    contact_phone: phone,
    invited_by: getField('invited_by')?.value.trim() || null,
    registered_via: 'public',
  };

  if (currentCategory === 'person') {
    payload.church_affiliation = getField('church_affiliation')?.value.trim() || null;
    payload.is_first_time = getField('is_first_time')?.checked ?? false;
  } else {
    payload.number_of_members = Number(getField('number_of_members')?.value) || 1;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <span class="spinner" style="width: 20px; height: 20px; border-width: 2.5px;"></span>
    <span>Securing your reservation…</span>
  `;

  const { data, error } = await supabase.from('registrants').insert(payload).select('id').maybeSingle();

  submitBtn.disabled = false;
  submitBtn.innerHTML = originalBtnHtml;

  if (error && error.code !== 'PGRST116') {
    console.error(error);
    showToast('Registration encountered an issue. Please check your connection and try again.', 'error');
    return;
  }

  // Send instant registration confirmation SMS to attendee
  sendRegistrationConfirmationSms({
    fullName,
    phone,
    registrantId: data?.id,
  }).catch((err) => console.warn('Confirmation SMS failed to dispatch:', err));

  // Populate digital pass confirmation preview
  const passName = document.getElementById('pass-attendee-name');
  if (passName) passName.textContent = fullName;

  const passPhone = document.getElementById('pass-attendee-phone');
  if (passPhone) passPhone.textContent = phoneRaw;

  const passCategory = document.getElementById('pass-attendee-category');
  if (passCategory) {
    const labels = { person: 'Individual Attendee', institution: 'Institution Delegation', church: 'Church Delegation' };
    passCategory.textContent = labels[currentCategory] || currentCategory;
  }

  const passLocation = document.getElementById('pass-attendee-location');
  if (passLocation) passLocation.textContent = payload.location || 'Not specified';

  // Smooth transition to confirmation pass
  form.hidden = true;
  const tabsContainer = document.querySelector('.reg-category-grid');
  if (tabsContainer) tabsContainer.hidden = true;

  const successEl = document.getElementById('reg-success');
  if (successEl) {
    successEl.hidden = false;
    successEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function setFieldError(inputEl, message) {
  if (!inputEl) return;
  const field = inputEl.closest('.field');
  if (field) {
    field.classList.add('has-error');
    const errorSpan = field.querySelector('.error');
    if (errorSpan && message) errorSpan.textContent = message;
  }
}

function clearErrors(scope) {
  scope.querySelectorAll('.field.has-error').forEach((f) => f.classList.remove('has-error'));
}
