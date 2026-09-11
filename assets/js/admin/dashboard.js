// ============================================================
// admin/dashboard.js — overview stats, live activity feed, trend chart.
// High-DPI canvas charting, real-time Supabase subscriptions,
// resilient error handling, and manual refresh controls.
// ============================================================

import { supabase } from '../config.js';
import { formatTime, escapeHtml } from '../utils.js';

let realtimeChannel = null;
let resizeHandlerAttached = false;
let isRefreshing = false;

export async function initDashboard() {
  // Bind manual refresh button
  const refreshBtn = document.getElementById('refresh-dashboard-btn');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = 'true';
    refreshBtn.addEventListener('click', async () => {
      if (isRefreshing) return;
      refreshBtn.classList.add('btn-spinning');
      const icon = refreshBtn.querySelector('i');
      if (icon) icon.classList.add('spin-animation');
      
      try {
        await refreshAll(false);
      } finally {
        setTimeout(() => {
          refreshBtn.classList.remove('btn-spinning');
          if (icon) icon.classList.remove('spin-animation');
        }, 500);
      }
    });
  }

  // Bind debounced window resize for high-DPI canvas
  if (!resizeHandlerAttached) {
    resizeHandlerAttached = true;
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const dashboardSection = document.getElementById('view-dashboard');
        if (dashboardSection && dashboardSection.classList.contains('admin-view--active')) {
          renderTrendChart();
        }
      }, 150);
    });
  }

  await refreshAll(true);
  subscribeRealtime();
}

async function refreshAll(showSkeletons = false) {
  isRefreshing = true;
  try {
    await Promise.allSettled([
      refreshStats(showSkeletons),
      refreshActivity(showSkeletons),
      renderTrendChart(),
    ]);
  } finally {
    isRefreshing = false;
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function refreshStats(showSkeletons = false) {
  const statGrid = document.getElementById('stat-grid');
  if (!statGrid) return;

  if (showSkeletons && statGrid.children.length === 0) {
    statGrid.innerHTML = `
      <div class="stat-card skeleton-card"><div class="skeleton skeleton-text" style="width: 50%;"></div><div class="skeleton skeleton-title" style="height: 2.2rem; width: 35%;"></div></div>
      <div class="stat-card skeleton-card"><div class="skeleton skeleton-text" style="width: 50%;"></div><div class="skeleton skeleton-title" style="height: 2.2rem; width: 35%;"></div></div>
      <div class="stat-card skeleton-card"><div class="skeleton skeleton-text" style="width: 50%;"></div><div class="skeleton skeleton-title" style="height: 2.2rem; width: 35%;"></div></div>
      <div class="stat-card skeleton-card"><div class="skeleton skeleton-text" style="width: 50%;"></div><div class="skeleton skeleton-title" style="height: 2.2rem; width: 35%;"></div></div>
    `;
  }

  let totalRegistered = 0;
  let checkedInToday = 0;
  let newToday = 0;

  try {
    const [regRes, checkInRes, newTodayRes] = await Promise.all([
      supabase.from('registrants').select('id', { count: 'exact', head: true }),
      supabase.from('check_ins').select('adults, children').gte('checked_in_at', startOfToday()),
      supabase.from('registrants').select('id', { count: 'exact', head: true }).gte('created_at', startOfToday()),
    ]);

    totalRegistered = regRes.count ?? 0;
    newToday = newTodayRes.count ?? 0;

    if (checkInRes.data && checkInRes.data.length > 0) {
      checkInRes.data.forEach((row) => {
        const pax = (Number(row.adults) || 1) + (Number(row.children) || 0);
        checkedInToday += Math.max(1, pax);
      });
    } else {
      checkedInToday = checkInRes.data?.length ?? 0;
    }
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
  }

  const rate = totalRegistered > 0 ? Math.min(100, Math.round((checkedInToday / totalRegistered) * 100)) : 0;

  const stats = [
    { label: 'Total Registered', value: totalRegistered.toLocaleString(), icon: 'bi-people-fill', color: '#2563EB', bg: '#EFF6FF' },
    { label: 'Checked-In Today', value: checkedInToday.toLocaleString(), icon: 'bi-person-check-fill', color: '#10B981', bg: '#ECFDF5' },
    { label: 'Check-in Rate', value: `${rate}%`, icon: 'bi-pie-chart-fill', color: '#8B5CF6', bg: '#F5F3FF' },
    { label: 'New Today', value: newToday.toLocaleString(), icon: 'bi-person-plus-fill', color: '#F59E0B', bg: '#FEF3C7' },
  ];

  statGrid.innerHTML = stats.map((s) => `
    <div class="stat-card">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
        <span class="stat-card__label" style="margin: 0;">${escapeHtml(s.label)}</span>
        <div style="width: 42px; height: 42px; border-radius: 10px; background: ${s.bg}; color: ${s.color}; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0;">
          <i class="bi ${s.icon}"></i>
        </div>
      </div>
      <div class="stat-card__value">${s.value}</div>
    </div>
  `).join('');
}

async function refreshActivity(showSkeletons = false) {
  const container = document.getElementById('recent-activity');
  if (!container) return;

  if (showSkeletons && container.innerHTML.trim() === '') {
    container.innerHTML = `
      <div class="skeleton skeleton-text" style="height: 1.6rem; margin-bottom: 8px;"></div>
      <div class="skeleton skeleton-text" style="height: 1.6rem; margin-bottom: 8px;"></div>
      <div class="skeleton skeleton-text" style="height: 1.6rem;"></div>
    `;
  }

  try {
    const { data, error } = await supabase
      .from('check_ins')
      .select('id, adults, children, sex, checked_in_at, registrants(full_name)')
      .order('checked_in_at', { ascending: false })
      .limit(6);

    if (error || !data || data.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 28px 16px; color: #94A3B8;">
          <i class="bi bi-inbox" style="font-size: 2rem; display: block; margin-bottom: 8px; opacity: 0.6;"></i>
          <p style="margin: 0; font-size: 0.9rem; font-weight: 500;">No check-ins recorded yet today.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.map((c) => {
      const name = c.registrants?.full_name || 'Walk-in / Direct Check-in';
      const adults = c.adults ?? 1;
      const children = c.children ?? 0;
      const totalPax = adults + children;
      const paxText = totalPax > 1 ? `${totalPax} pax` : '1 pax';
      const sexLabel = c.sex && c.sex !== 'group' ? c.sex.toUpperCase() : '';

      return `
        <div class="activity-item">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: #ECFDF5; color: #10B981; display: flex; align-items: center; justify-content: center; font-size: 0.9rem; flex-shrink: 0;">
              <i class="bi bi-check-lg"></i>
            </div>
            <div style="min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <div style="font-weight: 600; color: #0F172A; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${escapeHtml(name)}
              </div>
              <div style="font-size: 0.78rem; color: #64748B;">
                ${paxText}${sexLabel ? ` · ${sexLabel}` : ''}
              </div>
            </div>
          </div>
          <span class="activity-item__time" style="flex-shrink: 0; margin-left: 8px;">
            ${escapeHtml(formatTime(c.checked_in_at))}
          </span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching recent activity:', err);
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #EF4444; font-size: 0.88rem;">
        Failed to load activity. <a href="#" onclick="location.reload(); return false;" style="text-decoration: underline;">Retry</a>
      </div>
    `;
  }
}

async function renderTrendChart() {
  const canvas = document.getElementById('trend-chart');
  if (!canvas) return;

  const totalBadge = document.getElementById('trend-total-badge');

  // Build 14-day date buckets
  const daysCount = 14;
  const buckets = new Array(daysCount).fill(0);
  const labels = [];
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - (daysCount - 1));

  for (let i = 0; i < daysCount; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    // Format: "8 Sep" or "D/M"
    labels.push(d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }

  let totalInTrend = 0;

  try {
    const { data, error } = await supabase
      .from('registrants')
      .select('created_at')
      .gte('created_at', startDate.toISOString());

    if (!error && Array.isArray(data)) {
      totalInTrend = data.length;
      data.forEach((r) => {
        if (!r.created_at) return;
        const regDate = new Date(r.created_at);
        const dayDiff = Math.floor((regDate - startDate) / 86400000);
        if (dayDiff >= 0 && dayDiff < daysCount) {
          buckets[dayDiff]++;
        }
      });
    }
  } catch (err) {
    console.error('Error fetching registration trend:', err);
  }

  if (totalBadge) {
    totalBadge.textContent = `${totalInTrend.toLocaleString()} registered`;
  }

  drawCrispBarChart(canvas, buckets, labels);
}

function drawCrispBarChart(canvas, values, labels) {
  const container = canvas.parentElement;
  if (!container) return;

  const displayWidth = container.clientWidth || 400;
  const displayHeight = 210;

  // High-DPI Retina scaling
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(displayWidth * dpr);
  canvas.height = Math.floor(displayHeight * dpr);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;

  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, displayWidth, displayHeight);

  const paddingBottom = 28;
  const paddingTop = 24;
  const paddingSide = 8;
  const chartHeight = displayHeight - paddingBottom - paddingTop;
  const chartWidth = displayWidth - (paddingSide * 2);

  const maxVal = Math.max(...values, 1);
  const barCount = values.length;
  const slotWidth = chartWidth / barCount;
  const barWidth = Math.max(Math.min(slotWidth * 0.65, 28), 6);

  // Draw 2 horizontal guide lines
  ctx.strokeStyle = '#F1F5F9';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);

  [0.5, 1].forEach((fraction) => {
    const y = paddingTop + chartHeight * (1 - fraction);
    ctx.beginPath();
    ctx.moveTo(paddingSide, y);
    ctx.lineTo(displayWidth - paddingSide, y);
    ctx.stroke();
  });

  // Solid baseline
  ctx.setLineDash([]);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(paddingSide, paddingTop + chartHeight);
  ctx.lineTo(displayWidth - paddingSide, paddingTop + chartHeight);
  ctx.stroke();

  // Draw Bars
  values.forEach((val, i) => {
    const centerX = paddingSide + i * slotWidth + (slotWidth / 2);
    const x = centerX - (barWidth / 2);
    const barH = val > 0 ? Math.max((val / maxVal) * chartHeight, 4) : 0;
    const y = paddingTop + chartHeight - barH;

    if (val > 0) {
      // Rounded bar
      const radius = Math.min(barWidth / 2, 4);
      ctx.fillStyle = '#2563EB';

      // Bar gradient
      const gradient = ctx.createLinearGradient(0, y, 0, y + barH);
      gradient.addColorStop(0, '#3B82F6');
      gradient.addColorStop(1, '#1D4ED8');
      ctx.fillStyle = gradient;

      drawRoundedRect(ctx, x, y, barWidth, barH, radius);

      // Value label on top
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold 11px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(val), centerX, Math.max(y - 5, 12));
    }

    // Date label on bottom (show alternating if screen is narrow)
    const showEvery = displayWidth < 460 ? 3 : displayWidth < 680 ? 2 : 1;
    if (i % showEvery === 0 || i === barCount - 1) {
      ctx.fillStyle = '#64748B';
      ctx.font = '10px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(labels[i] || '', centerX, displayHeight - 8);
    }
  });

  // If all values are 0, display a centered empty state hint
  if (Math.max(...values) === 0) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = '500 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No registrations recorded in the last 14 days', displayWidth / 2, paddingTop + (chartHeight / 2));
  }

  ctx.restore();
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  if (ctx.roundRect) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, [radius, radius, 0, 0]);
    ctx.fill();
    return;
  }
  // Fallback for older browsers without roundRect
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();
}

function subscribeRealtime() {
  if (realtimeChannel) {
    try {
      supabase.removeChannel(realtimeChannel);
    } catch {
      // safe cleanup
    }
  }

  let debounceTimer = null;
  const debouncedRefresh = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      refreshAll(false);
    }, 400);
  };

  realtimeChannel = supabase
    .channel('dashboard-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins' }, debouncedRefresh)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'registrants' }, debouncedRefresh)
    .subscribe();
}
