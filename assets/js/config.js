// ============================================================
// Supabase configuration
// Loaded via <script type="module"> on every page that needs
// database access. The publishable/anon key is safe to expose in
// client-side code — it only grants what your RLS policies allow.
// NEVER put the service_role key here or in any frontend file.
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL = 'https://rhdqrocagrkogbztwpmg.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_rmQ97GXrUaGcsGIIFrdUeg_zj_5gfeI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Central place for small app-wide constants.
export const APP_CONFIG = {
  phoneCountryPrefix: '233', // Ghana. Used to auto-format numbers on entry.
  developer: {
    name: 'StackWeb Developer',
    tagline: 'Smart System. Real Solutions.',
    logoUrl: '',            // URL or image path to developer logo (leave empty to show vector brand icon)
    websiteUrl: '',         // Non-clickable by default
  },
};
