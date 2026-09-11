// ============================================================
// admin/conference-info.js — CMS management for event branding,
// dates, venue, flyer assets, live broadcast streams, and
// multi-day / multi-session program schedule builder.
// ============================================================

import { supabase } from '../config.js';
import { showToast, escapeHtml, formatDate, uploadImageWithFallback } from '../utils.js';

const BUCKET = 'conference-assets';
let settingsId = null;
let currentFlyerUrl = null;
let localFlyerBlobUrl = null;
let isFlyerMarkedForRemoval = false;
let isSaving = false;

// Schedule State: array of days, each with an array of sessions
let scheduleDays = [];

export async function initConferenceInfo() {
  await loadSettings();

  const form = document.getElementById('conference-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = 'true';
    form.addEventListener('submit', handleSave);

    // Live preview inputs
    const liveInputs = [
      'cf-name', 'cf-theme', 'cf-venue', 'cf-start', 'cf-end', 'cf-time', 'cf-desc', 'cf-fb', 'cf-yt',
      'cf-momo-network', 'cf-momo-number', 'cf-momo-name', 'cf-momo-title', 'cf-momo-note'
    ];
    liveInputs.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', updatePreview);
        el.addEventListener('change', updatePreview);
      }
    });

    // Date range validation
    const startInput = document.getElementById('cf-start');
    const endInput = document.getElementById('cf-end');
    if (startInput && endInput) {
      startInput.addEventListener('change', () => {
        if (startInput.value) {
          endInput.min = startInput.value;
        }
        validateDates();
        updatePreview();
      });
      endInput.addEventListener('change', () => {
        validateDates();
        updatePreview();
      });
    }

    // Flyer file input change
    const flyerInput = document.getElementById('cf-flyer');
    if (flyerInput) {
      flyerInput.addEventListener('change', handleFlyerSelect);
    }

    // Remove flyer button
    const removeFlyerBtn = document.getElementById('cf-remove-flyer-btn');
    if (removeFlyerBtn) {
      removeFlyerBtn.addEventListener('click', handleRemoveFlyer);
    }

    // Add Program Day button
    const addDayBtn = document.getElementById('cf-add-day-btn');
    if (addDayBtn) {
      addDayBtn.addEventListener('click', () => {
        const nextDayNum = scheduleDays.length + 1;
        
        // Auto-calculate subsequent date if start_date exists
        let defaultDate = '';
        const startVal = document.getElementById('cf-start')?.value;
        if (startVal) {
          const d = new Date(startVal);
          d.setDate(d.getDate() + (nextDayNum - 1));
          defaultDate = d.toISOString().split('T')[0];
        }

        scheduleDays.push({
          id: 'day-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          day_number: nextDayNum,
          day_title: `Day ${nextDayNum}`,
          date: defaultDate,
          theme: '',
          sessions: [
            {
              id: 'sess-' + Date.now() + '-1',
              time: '6:00 PM - 9:00 PM',
              title: `Day ${nextDayNum} General Session`,
              speaker: '',
              venue: '',
              description: '',
            }
          ]
        });

        renderScheduleBuilder();
        updatePreview();
      });
    }
  }
}

function validateDates() {
  const startVal = document.getElementById('cf-start')?.value;
  const endVal = document.getElementById('cf-end')?.value;
  const errorEl = document.getElementById('cf-date-error');

  if (startVal && endVal && endVal < startVal) {
    if (errorEl) errorEl.style.display = 'block';
    return false;
  }
  if (errorEl) errorEl.style.display = 'none';
  return true;
}

async function loadSettings() {
  try {
    const { data, error } = await supabase
      .from('conference_settings')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('Could not fetch conference settings:', error);
    }

    if (data) {
      settingsId = data.id;
      currentFlyerUrl = data.flyer_image_url || null;

      document.getElementById('cf-name').value = data.conference_name ?? '';
      document.getElementById('cf-theme').value = data.theme_scripture ?? '';
      document.getElementById('cf-venue').value = data.venue ?? '';
      document.getElementById('cf-start').value = data.start_date ?? '';
      document.getElementById('cf-end').value = data.end_date ?? '';
      let cleanDailyTime = data.daily_time ?? '';
      if (typeof cleanDailyTime === 'string' && cleanDailyTime.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(cleanDailyTime);
          cleanDailyTime = (parsed.summary && typeof parsed.summary === 'string') ? parsed.summary : '';
        } catch {
          cleanDailyTime = '';
        }
      }
      document.getElementById('cf-time').value = cleanDailyTime;
      document.getElementById('cf-desc').value = data.description ?? '';
      document.getElementById('cf-fb').value = data.facebook_live_url ?? '';
      document.getElementById('cf-yt').value = data.youtube_live_url ?? '';

      // Check for fallback in daily_time JSON or local cache if DB columns not yet present
      let momoFallback = {};
      if (typeof data.daily_time === 'string' && data.daily_time.startsWith('{')) {
        try {
          const parsed = JSON.parse(data.daily_time);
          if (parsed.momo) momoFallback = parsed.momo;
        } catch { /* ignore */ }
      }

      const momoNet = data.momo_network || momoFallback.network || 'MTN';
      const netSelect = document.getElementById('cf-momo-network');
      if (netSelect) netSelect.value = momoNet;

      const momoNum = data.momo_number || momoFallback.number || '';
      const numInput = document.getElementById('cf-momo-number');
      if (numInput) numInput.value = momoNum;

      const momoName = data.momo_account_name || momoFallback.account_name || '';
      const nameInput = document.getElementById('cf-momo-name');
      if (nameInput) nameInput.value = momoName;

      const momoTitle = data.donation_title || momoFallback.title || 'Partner & Support This Conference';
      const titleInput = document.getElementById('cf-momo-title');
      if (titleInput) titleInput.value = momoTitle;

      const momoNote = data.donation_note || momoFallback.note || 'Registration is 100% free. Voluntary donations support conference logistics, materials, and community outreach.';
      const noteInput = document.getElementById('cf-momo-note');
      if (noteInput) noteInput.value = momoNote;

      if (data.start_date) {
        const endInput = document.getElementById('cf-end');
        if (endInput) endInput.min = data.start_date;
      }

      // Parse schedule: check data.schedule first, then fallback to daily_time if JSON
      let loadedSchedule = null;
      if (Array.isArray(data.schedule) && data.schedule.length > 0) {
        loadedSchedule = data.schedule;
      } else if (typeof data.schedule === 'string' && data.schedule.startsWith('[')) {
        try { loadedSchedule = JSON.parse(data.schedule); } catch { /* ignore */ }
      } else if (typeof data.daily_time === 'string' && data.daily_time.startsWith('{')) {
        try {
          const parsed = JSON.parse(data.daily_time);
          if (Array.isArray(parsed.schedule)) {
            loadedSchedule = parsed.schedule;
          }
        } catch { /* ignore */ }
      }

      if (Array.isArray(loadedSchedule) && loadedSchedule.length > 0) {
        scheduleDays = loadedSchedule.map((d, i) => ({
          id: d.id || 'day-' + Date.now() + '-' + i,
          day_number: d.day_number || (i + 1),
          day_title: d.day_title || `Day ${i + 1}`,
          date: d.date || '',
          theme: d.theme || '',
          sessions: Array.isArray(d.sessions) ? d.sessions.map((s, j) => ({
            id: s.id || 'sess-' + Date.now() + '-' + j,
            time: s.time || '',
            title: s.title || '',
            speaker: s.speaker || '',
            venue: s.venue || '',
            description: s.description || '',
          })) : []
        }));
      } else {
        // Provide sample initial day structure for immediate visual feedback
        scheduleDays = [
          {
            id: 'day-initial-1',
            day_number: 1,
            day_title: 'Day 1',
            date: data.start_date || '',
            theme: 'Grand Opening & Impartation Service',
            sessions: [
              {
                id: 'sess-initial-1',
                time: '6:00 PM - 9:00 PM',
                title: 'Opening Night of Worship & Word Exposition',
                speaker: 'Keynote Speaker',
                venue: data.venue || 'Main Auditorium',
                description: 'Anointed praise, official conference opening, and keynote ministration.',
              }
            ]
          }
        ];
      }

      displayCurrentFlyer(currentFlyerUrl);
    } else {
      // Default initial day if no database record exists yet
      scheduleDays = [
        {
          id: 'day-initial-1',
          day_number: 1,
          day_title: 'Day 1',
          date: '',
          theme: 'Opening Night Service',
          sessions: [
            {
              id: 'sess-initial-1',
              time: '6:00 PM - 9:00 PM',
              title: 'Opening Service',
              speaker: '',
              venue: '',
              description: '',
            }
          ]
        }
      ];
    }
  } catch (err) {
    console.error('Error in loadSettings:', err);
  } finally {
    renderScheduleBuilder();
    updatePreview();
  }
}

// -------------------------------------------------------------
// Multi-Day Schedule Builder Rendering & Manipulation
// -------------------------------------------------------------

function renderScheduleBuilder() {
  const container = document.getElementById('cf-schedule-builder');
  if (!container) return;

  if (scheduleDays.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; background: #F8FAFC; border: 1.5px dashed #CBD5E1; border-radius: 12px; color: #64748B;">
        <i class="bi bi-calendar-x" style="font-size: 1.8rem; color: #94A3B8; display: block; margin-bottom: 6px;"></i>
        <p style="margin: 0 0 10px; font-weight: 500; font-size: 0.9rem;">No program schedule days configured yet.</p>
        <button type="button" class="btn btn--outline btn--sm" id="cf-empty-add-day-btn">
          <i class="bi bi-plus-circle-fill text-primary"></i>
          <span>Add First Day</span>
        </button>
      </div>
    `;

    document.getElementById('cf-empty-add-day-btn')?.addEventListener('click', () => {
      document.getElementById('cf-add-day-btn')?.click();
    });
    return;
  }

  container.innerHTML = scheduleDays.map((day, dayIndex) => {
    return `
      <div class="schedule-day-card" data-day-index="${dayIndex}">
        <div class="schedule-day-header">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span class="schedule-day-badge">
              <i class="bi bi-calendar2-day-fill"></i>
              <span>${escapeHtml(day.day_title || `Day ${dayIndex + 1}`)}</span>
            </span>
          </div>

          <button type="button" class="btn btn--outline btn--sm cf-remove-day-btn" data-day-index="${dayIndex}" style="padding: 4px 10px; font-size: 0.78rem; color: #DC2626; border-color: #FECACA;">
            <i class="bi bi-trash3"></i>
            <span>Remove Day</span>
          </button>
        </div>

        <div class="field-row" style="margin-bottom: 12px;">
          <div class="field" style="margin-bottom: 0;">
            <label style="font-size: 0.8rem; margin-bottom: 4px;">Day Label / Title</label>
            <input class="cf-day-title-input" data-day-index="${dayIndex}" value="${escapeHtml(day.day_title || '')}" placeholder="e.g. Day 1, Friday, Grand Opening" style="min-height: 42px; font-size: 0.92rem;" />
          </div>
          <div class="field" style="margin-bottom: 0;">
            <label style="font-size: 0.8rem; margin-bottom: 4px;">Date</label>
            <input type="date" class="cf-day-date-input" data-day-index="${dayIndex}" value="${escapeHtml(day.date || '')}" style="min-height: 42px; font-size: 0.92rem;" />
          </div>
        </div>

        <div class="field" style="margin-bottom: 14px;">
          <label style="font-size: 0.8rem; margin-bottom: 4px;">Day Theme / Spiritual Focus (Optional)</label>
          <input class="cf-day-theme-input" data-day-index="${dayIndex}" value="${escapeHtml(day.theme || '')}" placeholder="e.g. Night of Supernatural Healing &amp; Breakthrough" style="min-height: 42px; font-size: 0.92rem;" />
        </div>

        <!-- Sessions Container -->
        <div style="margin-top: 12px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <span style="font-size: 0.8rem; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em;">
              Sessions for ${escapeHtml(day.day_title || `Day ${dayIndex + 1}`)} (${day.sessions.length})
            </span>
            <button type="button" class="btn btn--outline btn--sm cf-add-session-btn" data-day-index="${dayIndex}" style="padding: 3px 8px; font-size: 0.76rem; background: #FFFFFF;">
              <i class="bi bi-plus-lg text-primary"></i>
              <span>Add Session</span>
            </button>
          </div>

          <div class="cf-sessions-list" data-day-index="${dayIndex}">
            ${day.sessions.map((session, sessIndex) => `
              <div class="schedule-session-item" data-day-index="${dayIndex}" data-sess-index="${sessIndex}">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <span style="font-size: 0.78rem; font-weight: 700; color: #2563EB; display: inline-flex; align-items: center; gap: 4px;">
                    <i class="bi bi-clock-history"></i> Session ${sessIndex + 1}
                  </span>
                  ${day.sessions.length > 1 ? `
                    <button type="button" class="cf-remove-session-btn" data-day-index="${dayIndex}" data-sess-index="${sessIndex}" style="background: none; border: none; color: #DC2626; cursor: pointer; font-size: 0.82rem; padding: 2px 6px;" title="Remove session">
                      <i class="bi bi-x-circle-fill"></i>
                    </button>
                  ` : ''}
                </div>

                <div class="field-row" style="margin-bottom: 8px;">
                  <div class="field" style="margin-bottom: 0;">
                    <label style="font-size: 0.78rem; margin-bottom: 3px;">Time / Duration *</label>
                    <input class="cf-sess-time-input" data-day-index="${dayIndex}" data-sess-index="${sessIndex}" value="${escapeHtml(session.time || '')}" placeholder="e.g. 9:00 AM - 12:00 PM" style="min-height: 40px; font-size: 0.9rem;" required />
                  </div>
                  <div class="field" style="margin-bottom: 0;">
                    <label style="font-size: 0.78rem; margin-bottom: 3px;">Session Title *</label>
                    <input class="cf-sess-title-input" data-day-index="${dayIndex}" data-sess-index="${sessIndex}" value="${escapeHtml(session.title || '')}" placeholder="e.g. Morning Leadership Seminar" style="min-height: 40px; font-size: 0.9rem;" required />
                  </div>
                </div>

                <div class="field-row" style="margin-bottom: 8px;">
                  <div class="field" style="margin-bottom: 0;">
                    <label style="font-size: 0.78rem; margin-bottom: 3px;">Keynote Speaker / Facilitator</label>
                    <input class="cf-sess-speaker-input" data-day-index="${dayIndex}" data-sess-index="${sessIndex}" value="${escapeHtml(session.speaker || '')}" placeholder="e.g. Rev. Dr. Mensah Otabil" style="min-height: 40px; font-size: 0.9rem;" />
                  </div>
                  <div class="field" style="margin-bottom: 0;">
                    <label style="font-size: 0.78rem; margin-bottom: 3px;">Room / Venue Location</label>
                    <input class="cf-sess-venue-input" data-day-index="${dayIndex}" data-sess-index="${sessIndex}" value="${escapeHtml(session.venue || '')}" placeholder="e.g. Main Auditorium or Room 2" style="min-height: 40px; font-size: 0.9rem;" />
                  </div>
                </div>

                <div class="field" style="margin-bottom: 0;">
                  <label style="font-size: 0.78rem; margin-bottom: 3px;">Description / Highlights</label>
                  <input class="cf-sess-desc-input" data-day-index="${dayIndex}" data-sess-index="${sessIndex}" value="${escapeHtml(session.description || '')}" placeholder="Brief overview of topic or focus..." style="min-height: 40px; font-size: 0.9rem;" />
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');

  bindScheduleBuilderEvents();
}

function bindScheduleBuilderEvents() {
  const container = document.getElementById('cf-schedule-builder');
  if (!container) return;

  // Day field updates
  container.querySelectorAll('.cf-day-title-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.dayIndex, 10);
      if (scheduleDays[idx]) {
        scheduleDays[idx].day_title = e.target.value.trim();
        updatePreview();
      }
    });
  });

  container.querySelectorAll('.cf-day-date-input').forEach((input) => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.dayIndex, 10);
      if (scheduleDays[idx]) {
        scheduleDays[idx].date = e.target.value;
        updatePreview();
      }
    });
  });

  container.querySelectorAll('.cf-day-theme-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.dayIndex, 10);
      if (scheduleDays[idx]) {
        scheduleDays[idx].theme = e.target.value.trim();
        updatePreview();
      }
    });
  });

  // Session field updates
  container.querySelectorAll('.cf-sess-time-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const dIdx = parseInt(e.target.dataset.dayIndex, 10);
      const sIdx = parseInt(e.target.dataset.sessIndex, 10);
      if (scheduleDays[dIdx]?.sessions[sIdx]) {
        scheduleDays[dIdx].sessions[sIdx].time = e.target.value;
        updatePreview();
      }
    });
  });

  container.querySelectorAll('.cf-sess-title-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const dIdx = parseInt(e.target.dataset.dayIndex, 10);
      const sIdx = parseInt(e.target.dataset.sessIndex, 10);
      if (scheduleDays[dIdx]?.sessions[sIdx]) {
        scheduleDays[dIdx].sessions[sIdx].title = e.target.value;
        updatePreview();
      }
    });
  });

  container.querySelectorAll('.cf-sess-speaker-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const dIdx = parseInt(e.target.dataset.dayIndex, 10);
      const sIdx = parseInt(e.target.dataset.sessIndex, 10);
      if (scheduleDays[dIdx]?.sessions[sIdx]) {
        scheduleDays[dIdx].sessions[sIdx].speaker = e.target.value;
      }
    });
  });

  container.querySelectorAll('.cf-sess-venue-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const dIdx = parseInt(e.target.dataset.dayIndex, 10);
      const sIdx = parseInt(e.target.dataset.sessIndex, 10);
      if (scheduleDays[dIdx]?.sessions[sIdx]) {
        scheduleDays[dIdx].sessions[sIdx].venue = e.target.value;
      }
    });
  });

  container.querySelectorAll('.cf-sess-desc-input').forEach((input) => {
    input.addEventListener('input', (e) => {
      const dIdx = parseInt(e.target.dataset.dayIndex, 10);
      const sIdx = parseInt(e.target.dataset.sessIndex, 10);
      if (scheduleDays[dIdx]?.sessions[sIdx]) {
        scheduleDays[dIdx].sessions[sIdx].description = e.target.value;
      }
    });
  });

  // Remove Day
  container.querySelectorAll('.cf-remove-day-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.dataset.dayIndex, 10);
      if (scheduleDays.length <= 1) {
        showToast('You must have at least one program day.', 'info');
        return;
      }
      scheduleDays.splice(idx, 1);
      // Re-number remaining days
      scheduleDays.forEach((d, i) => {
        d.day_number = i + 1;
        if (d.day_title.startsWith('Day ')) {
          d.day_title = `Day ${i + 1}`;
        }
      });
      renderScheduleBuilder();
      updatePreview();
    });
  });

  // Add Session to a specific day
  container.querySelectorAll('.cf-add-session-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dIdx = parseInt(btn.dataset.dayIndex, 10);
      if (scheduleDays[dIdx]) {
        const nextSessNum = scheduleDays[dIdx].sessions.length + 1;
        scheduleDays[dIdx].sessions.push({
          id: 'sess-' + Date.now() + '-' + nextSessNum,
          time: '6:00 PM - 9:00 PM',
          title: `Evening Session ${nextSessNum}`,
          speaker: '',
          venue: '',
          description: '',
        });
        renderScheduleBuilder();
        updatePreview();
      }
    });
  });

  // Remove Session
  container.querySelectorAll('.cf-remove-session-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dIdx = parseInt(btn.dataset.dayIndex, 10);
      const sIdx = parseInt(btn.dataset.sessIndex, 10);
      if (scheduleDays[dIdx] && scheduleDays[dIdx].sessions.length > 1) {
        scheduleDays[dIdx].sessions.splice(sIdx, 1);
        renderScheduleBuilder();
        updatePreview();
      }
    });
  });
}

function handleFlyerSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (JPG, PNG, WebP).', 'error');
    e.target.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('Image size exceeds 5MB limit. Please choose a smaller image.', 'error');
    e.target.value = '';
    return;
  }

  if (localFlyerBlobUrl) {
    URL.revokeObjectURL(localFlyerBlobUrl);
  }

  localFlyerBlobUrl = URL.createObjectURL(file);
  isFlyerMarkedForRemoval = false;
  displayCurrentFlyer(localFlyerBlobUrl, file.name);
  updatePreview();
}

function handleRemoveFlyer() {
  const flyerInput = document.getElementById('cf-flyer');
  if (flyerInput) flyerInput.value = '';

  if (localFlyerBlobUrl) {
    URL.revokeObjectURL(localFlyerBlobUrl);
    localFlyerBlobUrl = null;
  }

  isFlyerMarkedForRemoval = true;
  displayCurrentFlyer(null);
  updatePreview();
  showToast('Flyer removed from preview. Click Save to apply.', 'info');
}

function displayCurrentFlyer(url, fileName) {
  const wrap = document.getElementById('flyer-current-wrap');
  const img = document.getElementById('flyer-current-img');
  const nameEl = document.getElementById('flyer-current-name');

  if (!wrap || !img) return;

  if (url && !isFlyerMarkedForRemoval) {
    img.src = url;
    if (nameEl) nameEl.textContent = fileName || 'Active Conference Flyer';
    wrap.style.display = 'flex';
  } else {
    img.src = '';
    wrap.style.display = 'none';
  }
}

function updatePreview() {
  const container = document.getElementById('cf-preview-container');
  if (!container) return;

  const name = document.getElementById('cf-name')?.value.trim() || 'Annual Holy Ghost Conference';
  const theme = document.getElementById('cf-theme')?.value.trim() || 'Walking in Supernatural Favor';
  const venue = document.getElementById('cf-venue')?.value.trim() || 'Main Conference Auditorium';
  const start = document.getElementById('cf-start')?.value || '';
  const end = document.getElementById('cf-end')?.value || '';
  const dailyTime = document.getElementById('cf-time')?.value.trim() || '';
  const desc = document.getElementById('cf-desc')?.value.trim() || 'Join us for a life-transforming encounter with inspiring praise, word, and divine empowerment.';
  const fb = document.getElementById('cf-fb')?.value.trim() || '';
  const yt = document.getElementById('cf-yt')?.value.trim() || '';
  const momoNet = document.getElementById('cf-momo-network')?.value || 'MTN';
  const momoNum = document.getElementById('cf-momo-number')?.value.trim() || '';
  const momoName = document.getElementById('cf-momo-name')?.value.trim() || '';
  const momoTitle = document.getElementById('cf-momo-title')?.value.trim() || 'Partner & Support This Conference';
  const momoNote = document.getElementById('cf-momo-note')?.value.trim() || '';

  let flyerSrc = null;
  if (!isFlyerMarkedForRemoval) {
    flyerSrc = localFlyerBlobUrl || currentFlyerUrl;
  }

  let dateText = 'Dates to be announced';
  if (start && end) {
    dateText = `${formatDate(start)} – ${formatDate(end)}`;
  } else if (start) {
    dateText = `Starts ${formatDate(start)}`;
  }

  // Count total sessions in schedule
  const totalDays = scheduleDays.length;
  const totalSessions = scheduleDays.reduce((acc, d) => acc + (d.sessions?.length || 0), 0);

  const heroStyle = flyerSrc 
    ? `background-image: linear-gradient(150deg, rgba(11, 19, 41, 0.90) 0%, rgba(30, 58, 138, 0.85) 100%), url('${escapeHtml(flyerSrc)}');` 
    : `background: linear-gradient(150deg, #0B1329 0%, #1E3A8A 100%);`;

  container.innerHTML = `
    <div class="cf-preview-card">
      <div class="cf-preview-hero" style="${heroStyle}">
        <div class="cf-preview-hero__content">
          <div class="cf-preview-title">${escapeHtml(name)}</div>
          <div class="cf-preview-theme">“${escapeHtml(theme)}”</div>
          <div class="cf-preview-chips">
            <span class="cf-preview-chip">
              <i class="bi bi-calendar-event"></i>
              <span>${escapeHtml(dateText)}</span>
            </span>
            ${dailyTime ? `
              <span class="cf-preview-chip">
                <i class="bi bi-clock-fill"></i>
                <span>${escapeHtml(dailyTime)}</span>
              </span>
            ` : ''}
            <span class="cf-preview-chip">
              <i class="bi bi-geo-alt-fill"></i>
              <span>${escapeHtml(venue)}</span>
            </span>
          </div>
        </div>
      </div>
      <div class="cf-preview-body">
        <div class="cf-preview-desc">${escapeHtml(desc)}</div>
        
        <!-- Schedule Pill summary in Preview -->
        <div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 10px 12px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
          <div style="font-size: 0.82rem; font-weight: 600; color: #0F172A; display: inline-flex; align-items: center; gap: 6px;">
            <i class="bi bi-calendar3-range-fill text-primary"></i>
            <span>Program Schedule:</span>
          </div>
          <span style="font-size: 0.78rem; font-weight: 700; color: #2563EB; background: #EFF6FF; border: 1px solid #BFDBFE; padding: 2px 8px; border-radius: 999px;">
            ${totalDays} ${totalDays === 1 ? 'Day' : 'Days'} · ${totalSessions} ${totalSessions === 1 ? 'Session' : 'Sessions'}
          </span>
        </div>

        ${(fb || yt) ? `
          <div style="font-size: 0.76rem; font-weight: 700; color: #64748B; text-transform: uppercase; margin-bottom: 6px;">Live Broadcast Channels:</div>
          <div class="cf-preview-streams">
            ${fb ? `
              <span class="stream-badge stream-badge--fb">
                <i class="bi bi-facebook"></i> Facebook Live
              </span>
            ` : ''}
            ${yt ? `
              <span class="stream-badge stream-badge--yt">
                <i class="bi bi-youtube"></i> YouTube Live
              </span>
            ` : ''}
          </div>
        ` : ''}

        ${momoNum ? `
          <div style="margin-top: 14px; padding: 14px 16px; background: linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%); border: 1.5px solid #FDE68A; border-radius: 12px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <span style="font-size: 0.82rem; font-weight: 700; color: #92400E; display: inline-flex; align-items: center; gap: 6px;">
                <i class="bi bi-heart-fill" style="color: #EF4444;"></i> ${escapeHtml(momoTitle)}
              </span>
              <span style="font-size: 0.72rem; font-weight: 700; background: #FEF08A; color: #854D0E; padding: 2px 8px; border-radius: 6px; text-transform: uppercase;">
                ${escapeHtml(momoNet)}
              </span>
            </div>
            <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 4px; flex-wrap: wrap; gap: 6px;">
              <span style="font-size: 1.12rem; font-weight: 800; color: #0F172A; font-family: monospace; letter-spacing: 0.05em;">
                ${escapeHtml(momoNum)}
              </span>
              ${momoName ? `<span style="font-size: 0.78rem; font-weight: 600; color: #78350F;">${escapeHtml(momoName)}</span>` : ''}
            </div>
            ${momoNote ? `<div style="font-size: 0.74rem; color: #B45309; line-height: 1.35;">${escapeHtml(momoNote)}</div>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

async function handleSave(e) {
  e.preventDefault();
  if (isSaving) return;

  if (!validateDates()) {
    showToast('Please correct the date range before saving.', 'error');
    return;
  }

  const nameVal = document.getElementById('cf-name')?.value.trim();
  if (!nameVal) {
    showToast('Conference Name is required.', 'error');
    document.getElementById('cf-name')?.focus();
    return;
  }

  const submitBtn = document.getElementById('cf-submit-btn') || e.target.querySelector('button[type="submit"]');
  const originalBtnHtml = submitBtn.innerHTML;

  isSaving = true;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span>
    <span>Saving Changes…</span>
  `;

  try {
    const flyerFileInput = document.getElementById('cf-flyer');
    const flyerFile = flyerFileInput?.files?.[0];
    let flyerUrl = currentFlyerUrl;

    if (isFlyerMarkedForRemoval) {
      if (currentFlyerUrl) {
        await deleteOldFlyer(currentFlyerUrl);
      }
      flyerUrl = null;
      currentFlyerUrl = null;
    } else if (flyerFile) {
      const uploaded = await uploadFlyer(flyerFile);
      if (uploaded) {
        if (currentFlyerUrl && currentFlyerUrl !== uploaded) {
          await deleteOldFlyer(currentFlyerUrl);
        }
        flyerUrl = uploaded;
        currentFlyerUrl = uploaded;
      }
    }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData?.user?.id || null;
    const summaryTime = document.getElementById('cf-time')?.value.trim() || null;

    const momoData = {
      network: document.getElementById('cf-momo-network')?.value || 'MTN',
      number: document.getElementById('cf-momo-number')?.value.trim() || null,
      account_name: document.getElementById('cf-momo-name')?.value.trim() || null,
      title: document.getElementById('cf-momo-title')?.value.trim() || null,
      note: document.getElementById('cf-momo-note')?.value.trim() || null,
    };

    const payload = {
      conference_name: nameVal,
      theme_scripture: document.getElementById('cf-theme')?.value.trim() || null,
      venue: document.getElementById('cf-venue')?.value.trim() || null,
      start_date: document.getElementById('cf-start')?.value || null,
      end_date: document.getElementById('cf-end')?.value || null,
      daily_time: summaryTime,
      schedule: scheduleDays,
      description: document.getElementById('cf-desc')?.value.trim() || null,
      flyer_image_url: flyerUrl,
      facebook_live_url: document.getElementById('cf-fb')?.value.trim() || null,
      youtube_live_url: document.getElementById('cf-yt')?.value.trim() || null,
      momo_network: momoData.network,
      momo_number: momoData.number,
      momo_account_name: momoData.account_name,
      donation_title: momoData.title,
      donation_note: momoData.note,
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    let saveError = null;

    if (settingsId) {
      const res = await supabase
        .from('conference_settings')
        .update(payload)
        .eq('id', settingsId);
      saveError = res.error;

      // Resilient fallback: if DB does not have the new schedule or momo columns yet,
      // serialize them inside daily_time and update cleanly without error
      if (saveError && (saveError.message?.includes('momo') || saveError.message?.includes('donation') || saveError.message?.includes('schedule') || saveError.code === 'PGRST204')) {
        console.warn('New columns not yet in DB cache; serializing into daily_time fallback.');
        delete payload.schedule;
        delete payload.momo_network;
        delete payload.momo_number;
        delete payload.momo_account_name;
        delete payload.donation_title;
        delete payload.donation_note;
        payload.daily_time = JSON.stringify({
          summary: summaryTime || '',
          schedule: scheduleDays,
          momo: momoData
        });
        saveError = (await supabase.from('conference_settings').update(payload).eq('id', settingsId)).error;
      }
    } else {
      const res = await supabase
        .from('conference_settings')
        .insert(payload)
        .select('id')
        .single();
      saveError = res.error;

      if (saveError && (saveError.message?.includes('momo') || saveError.message?.includes('donation') || saveError.message?.includes('schedule') || saveError.code === 'PGRST204')) {
        delete payload.schedule;
        delete payload.momo_network;
        delete payload.momo_number;
        delete payload.momo_account_name;
        delete payload.donation_title;
        delete payload.donation_note;
        payload.daily_time = JSON.stringify({
          summary: summaryTime || '',
          schedule: scheduleDays,
          momo: momoData
        });
        const fallbackRes = await supabase.from('conference_settings').insert(payload).select('id').single();
        saveError = fallbackRes.error;
        if (fallbackRes.data?.id) settingsId = fallbackRes.data.id;
      } else if (res.data?.id) {
        settingsId = res.data.id;
      }
    }

    if (saveError) {
      console.error('Failed to save conference settings:', saveError);
      showToast('Failed to save conference changes. Please check permissions.', 'error');
      return;
    }

    if (localFlyerBlobUrl) {
      URL.revokeObjectURL(localFlyerBlobUrl);
      localFlyerBlobUrl = null;
    }
    if (flyerFileInput) flyerFileInput.value = '';
    isFlyerMarkedForRemoval = false;

    displayCurrentFlyer(currentFlyerUrl);
    updatePreview();
    showToast('Conference information & program schedule successfully updated!', 'success');
  } catch (err) {
    console.error('Unexpected error in handleSave:', err);
    showToast('An unexpected error occurred while saving.', 'error');
  } finally {
    isSaving = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnHtml;
  }
}

async function uploadFlyer(file) {
  try {
    const res = await uploadImageWithFallback(supabase, BUCKET, file, 'flyers', 1280);
    if (!res?.url) {
      showToast('Flyer processing failed. Continuing with text changes.', 'error');
      return null;
    }
    if (res.isFallback) {
      console.info('Flyer saved using compressed Data URL fallback.');
    }
    return res.url;
  } catch (err) {
    console.error('Exception during flyer upload:', err);
    return null;
  }
}

async function deleteOldFlyer(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return;
  try {
    const parts = url.split(`${BUCKET}/`);
    if (parts.length > 1) {
      const filePath = parts[1];
      if (filePath) {
        await supabase.storage.from(BUCKET).remove([filePath]);
      }
    }
  } catch (err) {
    console.warn('Could not delete old flyer asset:', err);
  }
}
