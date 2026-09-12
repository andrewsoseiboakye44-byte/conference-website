// ============================================================
// Shared helper functions used across public, admin, and usher pages.
// ============================================================

import { APP_CONFIG } from './config.js';

/**
 * Normalizes a Ghanaian phone number to 233XXXXXXXXX format.
 * Accepts input like "0241234567", "+233241234567", "233 24 123 4567".
 */
export function formatPhoneNumber(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  let digits = trimmed.replace(/\D/g, '');

  if (trimmed.startsWith('+')) {
    return digits;
  }
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = APP_CONFIG.phoneCountryPrefix + digits.slice(1);
  } else if (!digits.startsWith(APP_CONFIG.phoneCountryPrefix) && digits.length <= 10) {
    digits = APP_CONFIG.phoneCountryPrefix + digits;
  }
  return digits;
}

/** Basic sanity check: 12 digits, starts with country prefix. */
export function isValidPhoneNumber(formatted) {
  return /^\d{12}$/.test(formatted) && formatted.startsWith(APP_CONFIG.phoneCountryPrefix);
}

/** Lightweight toast notification. Call showToast('Saved!', 'success'). */
export function showToast(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast--visible'));

  setTimeout(() => {
    toast.classList.remove('toast--visible');
    setTimeout(() => toast.remove(), 300);
  }, 3800);
}

/** Formats a Date/ISO string as e.g. "Sep 12, 2026". */
export function formatDate(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Formats a Date/ISO string as e.g. "3:45 PM". */
export function formatTime(dateInput) {
  if (!dateInput) return '';
  const date = new Date(dateInput);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** Escapes text before injecting into innerHTML to avoid XSS from user-entered names etc. */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

/** Converts an array of objects to a CSV string and triggers a download. */
export function downloadCsv(filename, rows) {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ),
  ];
  const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Simple debounce for search inputs. */
export function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Initializes and synchronizes footer elements across pages:
 * - Dynamic copyright year
 * - Developer name, logo, and portfolio link from APP_CONFIG
 */
export function initFooter() {
  const currentYear = new Date().getFullYear();
  document.querySelectorAll('.footer-year, #footer-year').forEach((el) => {
    el.textContent = currentYear;
  });

  const devConfig = APP_CONFIG?.developer;
  if (!devConfig) return;

  if (devConfig.name) {
    document.querySelectorAll('.developer-name, #developer-name').forEach((el) => {
      el.textContent = devConfig.name;
    });
  }

  if (devConfig.tagline) {
    document.querySelectorAll('.developer-tagline, #developer-tagline').forEach((el) => {
      el.textContent = devConfig.tagline;
    });
  }

  // Remove any legacy logo elements to keep footer clean and minimalistic
  document.querySelectorAll('.developer-logo, #developer-logo').forEach((el) => {
    el.remove();
  });
}

/**
 * Compresses an image File using an offscreen canvas to a lightweight Data URL.
 * Produces ~25KB-80KB WebP or JPEG string that easily saves in Postgres text columns.
 */
export async function fileToDataUrl(file, maxWidth = 1200, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/webp', quality);
        if (!dataUrl.startsWith('data:image/webp')) {
          dataUrl = canvas.toDataURL('image/jpeg', quality);
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Uploads an image to Supabase Storage with automatic fallback to compressed Data URL
 * if the bucket is missing, permissions are restricted, or network fails.
 */
export async function uploadImageWithFallback(supabase, bucket, file, folder = 'uploads', maxDimension = 1200) {
  if (!file) return null;

  // 1. Attempt native Supabase Storage upload
  try {
    const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${folder}/${Date.now()}-${sanitized}`;

    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg',
    });

    if (!error) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      if (data?.publicUrl) {
        return { url: data.publicUrl, isFallback: false };
      }
    } else {
      console.warn(`Supabase Storage (${bucket}) upload error:`, error.message || error);
    }
  } catch (storageErr) {
    console.warn(`Supabase Storage (${bucket}) exception:`, storageErr);
  }

  // 2. Resilient Fallback: compress and embed as lightweight Data URL
  try {
    console.info(`Applying local compressed Data URL fallback for ${file.name}`);
    const dataUrl = await fileToDataUrl(file, maxDimension);
    return { url: dataUrl, isFallback: true };
  } catch (dataErr) {
    console.error('Failed to compress image:', dataErr);
    return null;
  }
}

// Auto-run when DOM is ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFooter);
  } else {
    initFooter();
  }
}


