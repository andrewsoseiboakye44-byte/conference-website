// ============================================================
// admin/speakers.js — CRUD for the speakers grid shown on the
// public page. Photos live in the "conference-assets" bucket;
// resilient fallback embeds compressed images if storage is restricted.
// ============================================================

import { supabase } from '../config.js';
import { showToast, escapeHtml, uploadImageWithFallback } from '../utils.js';

const BUCKET = 'conference-assets';
let speakers = [];
let editingPhotoUrl = null;
let localSpeakerBlobUrl = null;
let isSpeakerPhotoMarkedForRemoval = false;
let isSaving = false;

export async function initSpeakers() {
  await loadSpeakers();

  document.getElementById('add-speaker-btn')?.addEventListener('click', () => openModal(null));
  document.getElementById('speaker-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('speaker-close-x')?.addEventListener('click', () => closeModal());
  document.getElementById('speaker-modal')?.addEventListener('cancel', () => closeModal());
  document.getElementById('speaker-form')?.addEventListener('submit', handleSave);

  // Photo file selection change
  const photoInput = document.getElementById('speaker-photo');
  if (photoInput && !photoInput.dataset.bound) {
    photoInput.dataset.bound = 'true';
    photoInput.addEventListener('change', handlePhotoSelect);
  }

  // Remove photo button
  const removePhotoBtn = document.getElementById('speaker-photo-remove-btn');
  if (removePhotoBtn && !removePhotoBtn.dataset.bound) {
    removePhotoBtn.dataset.bound = 'true';
    removePhotoBtn.addEventListener('click', handleRemovePhoto);
  }
}

async function loadSpeakers() {
  try {
    const { data, error } = await supabase.from('speakers').select('*').order('display_order');
    if (error) throw error;
    speakers = data ?? [];
    renderGrid();
  } catch (err) {
    console.error('Failed to load speakers:', err);
  }
}

function renderGrid() {
  const grid = document.getElementById('speaker-admin-grid');
  if (!grid) return;

  if (speakers.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 280px;">
        <div style="width: 64px; height: 64px; border-radius: 18px; background: #EFF6FF; color: #2563EB; display: flex; align-items: center; justify-content: center; font-size: 1.8rem; margin-bottom: 16px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.12);">
          <i class="bi bi-mic-fill"></i>
        </div>
        <h3 style="font-size: 1.2rem; font-weight: 700; color: #0F172A; margin: 0 0 6px;">No Keynote Speakers Added</h3>
        <p class="hint" style="max-width: 400px; margin: 0 auto 20px; font-size: 0.92rem;">Add conference ministers and keynote speakers so they appear on the public portal.</p>
        <button type="button" class="btn btn--primary" id="empty-add-speaker-btn">
          <i class="bi bi-plus-circle-fill"></i>
          <span>Add First Speaker</span>
        </button>
      </div>
    `;
    document.getElementById('empty-add-speaker-btn')?.addEventListener('click', () => openModal(null));
    return;
  }

  grid.innerHTML = speakers.map((s) => `
    <div class="speaker-admin-card">
      <img src="${escapeHtml(s.photo_url || './assets/images/default-avatar.svg')}" alt="${escapeHtml(s.name)}" onerror="this.src='./assets/images/default-avatar.svg'" />
      <p><strong>${escapeHtml(s.name)}</strong></p>
      <p class="hint">${escapeHtml(s.title ?? '')}</p>
      <div class="speaker-admin-card__actions">
        <button type="button" class="btn btn--outline" data-edit="${s.id}">Edit</button>
        <button type="button" class="btn btn--ghost" data-delete="${s.id}">Delete</button>
      </div>
    </div>
  `).join('');

  grid.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.addEventListener('click', () => openModal(speakers.find((s) => s.id === btn.dataset.edit)));
  });
  grid.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.addEventListener('click', () => handleDelete(btn.dataset.delete));
  });
}

function handlePhotoSelect(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (JPG, PNG, WebP).', 'error');
    e.target.value = '';
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast('Image size exceeds 5MB limit.', 'error');
    e.target.value = '';
    return;
  }

  if (localSpeakerBlobUrl) {
    URL.revokeObjectURL(localSpeakerBlobUrl);
  }

  localSpeakerBlobUrl = URL.createObjectURL(file);
  isSpeakerPhotoMarkedForRemoval = false;
  displaySpeakerPhotoPreview(localSpeakerBlobUrl, file.name);
}

function handleRemovePhoto() {
  const photoInput = document.getElementById('speaker-photo');
  if (photoInput) photoInput.value = '';

  if (localSpeakerBlobUrl) {
    URL.revokeObjectURL(localSpeakerBlobUrl);
    localSpeakerBlobUrl = null;
  }

  isSpeakerPhotoMarkedForRemoval = true;
  displaySpeakerPhotoPreview(null);
  showToast('Speaker photo removed. Click Save to apply.', 'info');
}

function displaySpeakerPhotoPreview(url, name) {
  const wrap = document.getElementById('speaker-photo-preview-wrap');
  const img = document.getElementById('speaker-photo-preview');
  const nameEl = document.getElementById('speaker-photo-name');

  if (!wrap || !img) return;

  if (url && !isSpeakerPhotoMarkedForRemoval) {
    img.src = url;
    if (nameEl) nameEl.textContent = name || 'Speaker photo selected';
    wrap.style.display = 'flex';
  } else {
    img.src = '';
    wrap.style.display = 'none';
  }
}

function openModal(speaker) {
  document.getElementById('speaker-modal-title').innerHTML = speaker
    ? '<i class="bi bi-pencil-square text-primary"></i> Edit Speaker'
    : '<i class="bi bi-mic-fill text-primary"></i> Add Speaker';

  document.getElementById('speaker-id').value = speaker?.id ?? '';
  document.getElementById('speaker-name').value = speaker?.name ?? '';
  document.getElementById('speaker-title').value = speaker?.title ?? '';
  document.getElementById('speaker-bio').value = speaker?.bio ?? '';
  document.getElementById('speaker-order').value = speaker?.display_order ?? speakers.length;

  const photoInput = document.getElementById('speaker-photo');
  if (photoInput) photoInput.value = '';

  if (localSpeakerBlobUrl) {
    URL.revokeObjectURL(localSpeakerBlobUrl);
    localSpeakerBlobUrl = null;
  }

  editingPhotoUrl = speaker?.photo_url ?? null;
  isSpeakerPhotoMarkedForRemoval = false;

  displaySpeakerPhotoPreview(editingPhotoUrl, 'Active Speaker Photo');

  document.getElementById('speaker-modal').showModal();
}

function closeModal() {
  if (localSpeakerBlobUrl) {
    URL.revokeObjectURL(localSpeakerBlobUrl);
    localSpeakerBlobUrl = null;
  }
  document.getElementById('speaker-modal').close();
}

async function handleSave(e) {
  e.preventDefault();
  if (isSaving) return;

  const nameVal = document.getElementById('speaker-name').value.trim();
  if (!nameVal) {
    showToast('Speaker name is required.', 'error');
    document.getElementById('speaker-name').focus();
    return;
  }

  const id = document.getElementById('speaker-id').value || null;
  const photoFile = document.getElementById('speaker-photo').files[0];
  const submitBtn = document.getElementById('speaker-submit-btn') || document.querySelector('#speaker-modal button[type="submit"]');
  const originalBtnHtml = submitBtn.innerHTML;

  isSaving = true;
  submitBtn.disabled = true;
  submitBtn.innerHTML = `
    <span class="spin-animation"><i class="bi bi-arrow-repeat"></i></span>
    <span>Saving…</span>
  `;

  try {
    let photoUrl = editingPhotoUrl;

    if (isSpeakerPhotoMarkedForRemoval) {
      if (editingPhotoUrl) {
        await deleteOldPhoto(editingPhotoUrl);
      }
      photoUrl = null;
      editingPhotoUrl = null;
    } else if (photoFile) {
      const uploaded = await uploadPhoto(photoFile);
      if (uploaded) {
        if (editingPhotoUrl && editingPhotoUrl !== uploaded) {
          await deleteOldPhoto(editingPhotoUrl);
        }
        photoUrl = uploaded;
        editingPhotoUrl = uploaded;
      }
    }

    const payload = {
      name: nameVal,
      title: document.getElementById('speaker-title').value.trim() || null,
      bio: document.getElementById('speaker-bio').value.trim() || null,
      photo_url: photoUrl,
      display_order: Number(document.getElementById('speaker-order').value) || 0,
    };

    const { error } = id
      ? await supabase.from('speakers').update(payload).eq('id', id)
      : await supabase.from('speakers').insert(payload);

    if (error) {
      console.error('Failed to save speaker:', error);
      showToast('Failed to save speaker. Please check permissions.', 'error');
      return;
    }

    showToast(id ? 'Speaker updated successfully!' : 'New speaker added successfully!', 'success');
    closeModal();
    await loadSpeakers();
  } catch (err) {
    console.error('Unexpected error in handleSave speaker:', err);
    showToast('An unexpected error occurred.', 'error');
  } finally {
    isSaving = false;
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalBtnHtml;
  }
}

async function handleDelete(id) {
  if (!confirm('Are you sure you want to delete this speaker?')) return;
  const speaker = speakers.find((s) => s.id === id);

  try {
    const { error } = await supabase.from('speakers').delete().eq('id', id);
    if (error) throw error;

    if (speaker?.photo_url) {
      await deleteOldPhoto(speaker.photo_url);
    }
    showToast('Speaker deleted successfully.', 'success');
    await loadSpeakers();
  } catch (err) {
    console.error('Failed to delete speaker:', err);
    showToast('Failed to delete speaker.', 'error');
  }
}

async function uploadPhoto(file) {
  try {
    const res = await uploadImageWithFallback(supabase, BUCKET, file, 'speakers', 600);
    if (!res?.url) {
      showToast('Photo upload failed. Saving speaker without updated photo.', 'error');
      return null;
    }
    if (res.isFallback) {
      console.info('Speaker photo saved using compressed Data URL fallback.');
    }
    return res.url;
  } catch (err) {
    console.error('Exception during speaker photo upload:', err);
    return null;
  }
}

async function deleteOldPhoto(url) {
  if (!url || typeof url !== 'string' || url.startsWith('data:')) return;
  try {
    const parts = url.split(`${BUCKET}/`);
    if (parts.length > 1) {
      const path = parts[1];
      if (path) await supabase.storage.from(BUCKET).remove([path]);
    }
  } catch (err) {
    console.warn('Could not delete old photo:', err);
  }
}
