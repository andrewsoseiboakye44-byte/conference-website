// ============================================================
// auth.js — shared login/logout/session logic.
// Both admin and usher accounts are real Supabase Auth users;
// the "usher" login form just signs in with a fixed email like
// usher@yourchurch.local behind the scenes so it feels like a
// username, while still going through Supabase Auth + RLS.
// ============================================================

import { supabase } from './config.js';

/** Signs in with email + password. Returns { user, profile } or throws. */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const profile = await getCurrentProfile();
  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    throw new Error('This account is disabled. Contact your admin.');
  }
  return { user: data.user, profile };
}

/** Usher login: converts a plain username into the internal usher email. */
export async function signInAsUsher(username, password) {
  const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
  const email = `${cleanUsername}@usher.local`;
  return signIn(email, password);
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = './login.html';
}

/** Returns the current session's profile row (role, username, etc.) or null. */
export async function getCurrentProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) return null;
  return data;
}

/**
 * Route guard. Call at the top of admin.html / usher.html scripts.
 * Redirects to /login.html if not authenticated, or to the correct
 * page if logged in under a different role.
 */
export async function requireRole(requiredRole) {
  const profile = await getCurrentProfile();

  if (!profile) {
    window.location.href = './login.html';
    return null;
  }

  const allowed = requiredRole === 'admin'
    ? profile.role === 'admin'
    : profile.role === 'admin' || profile.role === 'usher';

  if (!allowed) {
    window.location.href = './login.html';
    return null;
  }

  return profile;
}
