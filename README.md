# Church Conference Management System

A mobile-first web app for churches to manage annual conferences: online registration, door check-in, SMS communication, and live attendance tracking.

- **Public registration** — `index.html`
- **Admin dashboard** — `admin.html`
- **Usher check-in (tablet)** — `usher.html`
- **Shared login** — `login.html`

Built on plain HTML/CSS/JS (no build step) + [Supabase](https://supabase.com) for the database, auth, storage, realtime, and edge functions.

---

## 1. Project status

Your Supabase project is already connected in `assets/js/config.js` (URL + anon key). What's left before this is fully live:

- [ ] Run the SQL migrations (§3)
- [ ] Create the Storage bucket for flyer/speaker images (§4)
- [ ] Set Edge Function secrets and deploy them (§5)
- [ ] Create your first admin account (§6)
- [ ] Configure your SMS gateway from the Admin Dashboard (§7)

---

## 2. Run it locally

No build step needed — it's static files.

```bash
npm install
npm run dev
```

This serves the folder at `http://localhost:5500`. Open `index.html` for the public page, `login.html` to sign in.

> Because these are plain `<script type="module">` files loaded relative to the domain root (`/assets/...`), serve the folder from its root — don't open `index.html` directly via `file://`.

---

## 3. Run the database migrations

Install the [Supabase CLI](https://supabase.com/docs/guides/cli) if you haven't:

```bash
npm install -g supabase
supabase login
supabase link --project-ref rhdqrocagrkogbztwpmg
supabase db push
```

This runs every file in `supabase/migrations/` in order, creating all 8 tables with Row Level Security already configured.

Optional sample data:

```bash
supabase db execute -f supabase/seeds/sample_speakers.sql
```

---

## 4. Create the Storage bucket

The admin's flyer upload and speaker photo upload both use a bucket called **`conference-assets`**.

1. In the Supabase dashboard → **Storage** → **New bucket**
2. Name: `conference-assets`
3. **Public bucket**: ON (so images render on the public page without extra signing)
4. Save

---

## 5. Deploy the Edge Functions

These handle everything that needs the secret `service_role` key — sending SMS, encrypting gateway credentials, and creating/managing usher accounts. They live in `supabase/functions/`:

| Function | Purpose |
|---|---|
| `send-sms` | Auto-confirmation SMS after public registration |
| `send-bulk-sms` | The 4 manual campaigns + invite-contacts batches |
| `test-sms` | "Send test SMS" button in gateway settings |
| `save-gateway-settings` | Encrypts & stores SMS provider credentials |
| `create-usher` | Creates a usher login (admin only) |
| `reset-usher-password` | Resets a usher's password (admin only) |

Set the secrets they need (fill in `.env` first, then):

```bash
supabase secrets set --env-file .env
```

You need:
- `SUPABASE_SERVICE_ROLE_KEY` — Project Settings → API → `service_role` key
- `ENCRYPTION_KEY` — generate with `openssl rand -base64 32`

Then deploy:

```bash
supabase functions deploy send-sms
supabase functions deploy send-bulk-sms
supabase functions deploy test-sms
supabase functions deploy save-gateway-settings
supabase functions deploy create-usher
supabase functions deploy reset-usher-password
```

**`send-sms` needs to be callable anonymously** (it fires right after a public registration, before anyone is logged in). In the Supabase dashboard, under that function's settings, disable "Enforce JWT verification" — or leave it enforced and the frontend will pass the anon key automatically, since `supabase.functions.invoke()` already sends it.

---

## 6. Create your first admin account

There's no public admin sign-up (by design). Create the account directly:

1. Supabase dashboard → **Authentication** → **Users** → **Add user**
2. Enter your email + a password, and check "Auto Confirm User"
3. Copy the new user's **UID**
4. Supabase dashboard → **Table Editor** → `profiles` → **Insert row**
   - `id`: the UID you copied
   - `role`: `admin`
   - `is_active`: `true`
5. Go to `login.html` on your deployed site, select the **Admin** tab, and sign in.

From there, use **Manage Users** in the admin dashboard to create usher accounts — no more manual SQL needed.

---

## 7. Configure SMS

1. Sign in as admin → **SMS Gateway Settings**
2. Choose your provider (Africa's Talking is pre-wired; Twilio is pre-wired; Vonage/Custom need a few lines added in `supabase/functions/_shared/supabase-admin.ts` — the shape is documented there)
3. Enter your API key/secret and sender ID, save
4. Click **Send test SMS** to confirm it works before running a real campaign

---

## 8. Deploy the frontend

Any static host works. Netlify/Vercel are the easiest:

**Netlify**
```bash
npx netlify deploy --prod
```

**Vercel**
```bash
npx vercel --prod
```

Point your domain (e.g. `conference.yourchurch.com`) at whichever you choose.

---

## Folder structure

```
conference-website/
├── index.html          # Public registration page
├── admin.html           # Admin Dashboard
├── usher.html           # Usher Check-In Page
├── login.html            # Login page
├── assets/
│   ├── css/              # base.css (shared tokens) + one file per page
│   ├── js/
│   │   ├── config.js      # Supabase client + app config
│   │   ├── auth.js        # Login/logout/session/role guard
│   │   ├── public.js      # Public registration page logic
│   │   ├── login.js       # Login page logic
│   │   ├── usher.js       # Usher check-in logic
│   │   ├── sms.js         # Shared SMS-sending helper
│   │   └── admin/         # One module per admin section (8 files)
│   └── images/uploads/    # (unused locally — real uploads go to Supabase Storage)
├── supabase/
│   ├── migrations/        # 9 SQL files — run in order via `supabase db push`
│   ├── functions/         # 6 Edge Functions + shared helpers
│   └── seeds/             # Optional sample data
├── .env                   # Edge Function secrets template (never commit real values)
├── .gitignore
├── package.json
└── README.md
```

## Design tokens

| Token | Value | Usage |
|---|---|---|
| Primary Blue | `#2563EB` | Buttons, links, headers |
| Accent Yellow | `#FBBF24` | CTAs, highlights, alerts |
| Dark Slate | `#1E293B` | Footer, sidebar, headings |
| Font | Inter | with system-font fallback |

All defined as CSS custom properties in `assets/css/base.css`.

## Security notes

- The anon key in `config.js` is meant to be public — every table it can touch is locked down by Row Level Security (see each migration file).
- The `service_role` key and `ENCRYPTION_KEY` live only in Supabase's Edge Function secrets — never in this repo, never in the frontend.
- SMS provider credentials are encrypted (AES-GCM) before being stored in `sms_gateway_settings`; only the Edge Functions can decrypt them.
- Ushers share one login, but every check-in and door registration they make is attributed to that account in `usher_activity_log` for auditing.
