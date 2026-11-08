# Shared Item Bookings (caravans, trailers, gear)

A progressive web app where members book shared items by the day. Admins approve members, grant per-item access, set booking frequency limits, manage bookings and items, and can book on anyone's behalf — including themselves. Google and email/password sign-in, phone number captured after signup, condition report photos/videos at pickup and return, parking address capture, and daily reminder emails.

Built to run entirely on free tiers: **Cloudflare Workers + D1 + R2**, deployed from **GitHub Actions**.

---

## What you get

**Members**
- Sign in with Google or email + password; phone number is requested right after signup.
- Item grid with photo, live availability, and a “who last used it” line.
- Per-item month calendar: free days, booked days (with the booker's name, visible to everyone) and your own bookings in a different colour.
- Book a date range by tapping the calendar or typing dates; server enforces every restriction.
- Upload the pickup condition report (photo or video) on the booking start day, the return report on the last day, and the parking address once the booking is over.
- Cancel a booking any time before it starts; see all their bookings and what is still outstanding.

**Admins**
- Approve or suspend members, change their role, delete members (kept when they have booking history — suspend instead).
- Grant item access per member: one person can be limited to the trailer while another gets the caravan.
- Reset a member's password (signs out their sessions).
- Add/edit items, upload the item photo, retire items that have booking history.
- Per-item booking rules that override club defaults: max days per booking, bookings per period, period length, minimum gap, book-ahead window.
- Club-wide default rules, club name and timezone.
- Book any item for any member or for themselves, edit dates/item/status, delete bookings (and their uploaded media).
- Review every condition report, and every parking address.

**Automation**
- Daily cron (`0 7 * * *` UTC) emails: pickup report reminder on the first day, return report reminder on the last day, parking address prompt afterwards. Repeats a few times until actioned; never sends twice in one day.
- Manual “Run the reminder sweep now” button in Admin → Settings.

---

## Costs

| Piece | Free tier |
| --- | --- |
| Cloudflare Workers | 100k requests/day |
| Cloudflare D1 | 5 GB storage, 5M row reads/day |
| Cloudflare R2 | 10 GB storage, free egress |
| Resend email | 3,000 emails/month, 100/day |
| GitHub Actions | 2,000 minutes/month |

No paid plan is required. Password hashing is tuned (PBKDF2, 12k iterations) to stay inside the Workers free CPU budget; raise `PBKDF2_ITERATIONS` in `worker/lib/auth.ts` if you move to a paid plan.

---

## What you need to supply

1. A **Cloudflare account** (free) — hosting, D1, R2.
2. A **domain you control, added to Cloudflare** (free) — needed only for real outbound email, because Resend must verify a sender domain. Without it the app runs fine and emails are logged instead of sent.
3. A **Google Cloud OAuth client** (free) — optional; only for "Continue with Google".
4. A **Resend account** (free) — for the reminder emails.
5. A **GitHub repository** — for the automatic deploy workflow.

Nothing else.

---

## Local development

```bash
npm install
npm run icons                 # only needed if you change the icon generator
npm run db:local              # create the local D1 schema
npm run build
npx wrangler dev --port 8787  # serves the app + API at http://localhost:8787
```

Optional local secrets (copy `.dev.vars.example` to `.dev.vars`):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
RESEND_API_KEY=...
EMAIL_FROM="Caravan Club <bookings@yourdomain.com>"
ADMIN_EMAILS=you@example.com
```

Authorised Google redirect URI for local dev: `http://localhost:8787/api/auth/google/callback`.

**The first account created becomes an admin and is approved automatically** — useful for a fresh database. You can also list `ADMIN_EMAILS` (comma separated) so those addresses are auto-approved as admins.

Other scripts:

```bash
npm run typecheck   # frontend + worker TypeScript
npm run deploy      # typecheck, build, wrangler deploy
```

---

## Deploy to Cloudflare (first time)

```bash
npx wrangler login

# 1. Create the resources
npx wrangler d1 create caravan_booking
npx wrangler r2 bucket create caravan-booking-media

# 2. Paste the database_id printed above into wrangler.jsonc
#    (it replaces REPLACE_WITH_YOUR_D1_DATABASE_ID)

# 3. Create the schema on the real database
npm run db:remote

# 4. Add secrets (never commit these)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
npx wrangler secret put ADMIN_EMAILS

# 5. Ship it
npm run deploy
```

Then set `APP_URL` in `wrangler.jsonc` to the deployed `https://…workers.dev` URL (or your custom domain) and deploy again — that is what reminder emails link to.

### Google sign-in

Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID → Web application.

Authorised redirect URIs:

```
https://<your-domain>/api/auth/google/callback
http://localhost:8787/api/auth/google/callback   (local dev)
```

The button only appears when both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

### Email (Resend)

1. Create a Resend account and add your domain.
2. Add the DNS records Resend gives you in Cloudflare DNS.
3. Create an API key.
4. Set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Caravan Club <bookings@yourdomain.com>`).

Without a key, the app still records what it *would* send and shows it in the Worker logs — nothing breaks.

### Automatic deploys from GitHub

Push the repo to GitHub, then in the repository settings add two secrets:

- `CLOUDFLARE_API_TOKEN` — a token with the *Edit Cloudflare Workers* + *D1* + *R2* permissions
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard

`.github/workflows/deploy.yml` typechecks, builds, applies D1 migrations and deploys on every push to `main`.

### Custom domain

Workers dashboard → your Worker → Settings → Domains & Routes → Add custom domain. Then update `APP_URL` and add the new callback URL in Google.

---

## How the rules work

- One shared item can only have one confirmed booking per day; overlapping requests are refused and name the person who has it.
- Members see only items they were granted (admins see everything).
- Defaults (club-wide): max 7 days per booking, 2 bookings per 30 days, 3 day minimum gap, book up to 90 days ahead.
- Per-item overrides replace individual defaults; blank means inherit.
- Admins skip the frequency, gap, advance and outstanding-report rules, but never the double-booking check.
- A member with an outstanding return report cannot book again until they upload it.
- Reports open on the booking start day; the return report and parking address open on the last day.

## Data model

`users`, `sessions`, `items`, `item_access`, `bookings`, `reports`, `returns`, `reminders`, `settings`, `auth_attempts` — see `migrations/0001_init.sql`.

## Notes and limits

- Dates are calendar days; "today" is decided by the timezone in Admin → Settings (default `UTC` — set it to `Australia/Sydney`, `Europe/London`, etc.).
- Uploads are capped at 25 MB (12 MB for item photos) and stored in R2, served only to signed-in members.
- Sessions are httpOnly cookies valid for 30 days; deleting a user does not delete their bookings, so delete or reassign those first.
- The PWA caches the app shell only; calendars and bookings always come from the network.
