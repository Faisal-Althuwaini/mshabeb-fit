# DECISIONS — Mushabbab Coach

M0 discovery notes for the Mushabbab Coach build plan, and every place the plan was adjusted to fit the existing bot.

## What exists today (as of 2026-11-12)

| Area | Current state |
|---|---|
| Runtime | Node.js (CommonJS) + Telegraf, **long polling**, kept alive with pm2 on a VPS. `express` serves `/` and `/health` (left over from Render). |
| Scheduling | `node-cron` inside the bot process: a per-minute check for daily reminders, plus a weekly summary at `0 18 * * 6` UTC (Saturday 21:00 Riyadh). |
| DB access | `@supabase/supabase-js` with the **service role key**. No anon key, no Supabase Auth, no RLS. |
| Tables | `users (telegram_user_id bigint PK, username, first_name, last_name, reminder_enabled, reminder_time time, created_at, updated_at)` and `weight_entries (id uuid PK, user_id bigint → users, weight numeric(5,2) check 20–300, recorded_at date, created_at, unique(user_id, recorded_at))`. |
| Weight parsing | `parseWeight`: replaces `,` with `.`, accepts 20–300, rounds to 0.1. The plain-number router regex only accepts ASCII digits. |
| Weekly average | `getWeeklyAverages`: arithmetic mean of the week's entries, **rounded to 1 decimal** (`Math.round(x*10)/10`). Returns `{thisWeekAvg, lastWeekAvg, thisWeekCount, lastWeekCount}`. |
| Week definition | `startOfWeek` → **Monday–Sunday**, computed on **UTC** dates. |
| "Today" | `new Date().toISOString().slice(0,10)` → the **UTC** date, not the Riyadh date. |
| Reminder | Default 08:00 Riyadh, set on `/start`; `/reminder HH:MM` / `/reminder off`. |

## Decisions

### D1. Runtime: extend the Node bot (plan §2 conflict)
The plan assumes a `telegram-webhook` Edge Function and pg_cron → `coach-cron`. **Decision (Faisal, 2026-11-12):** keep the Node process. It handles Telegram, the coaching tick (node-cron every 15 min instead of pg_cron), DeepSeek calls, and Web Push (`web-push` runs natively in Node). Only `coach-chat` becomes a Supabase Edge Function, because the PWA needs an authenticated HTTPS endpoint. Secrets (`DEEPSEEK_API_KEY`, VAPID keys) go in the VPS `.env`; `DEEPSEEK_API_KEY` is also stored in Supabase secrets for `coach-chat`.

### D2. Week = Sunday–Saturday (plan §3 / open point 1)
**Decision (Faisal):** Sunday–Saturday everywhere. This changes how *existing* weekly averages are grouped (they used to be Mon–Sun); the raw weights are untouched. The Saturday 21:00 report now covers the whole week.

### D3. Dates are Riyadh local dates (bug fix)
The existing code used UTC dates, so a weigh-in between 00:00 and 03:00 Riyadh was saved under the previous day, and weeks rolled over at 03:00 Riyadh. All "today" and week math now uses the user's timezone (`Asia/Riyadh`). This changes existing behaviour, but it fixes a bug and is required for "one weigh-in per local day".

### D4. Identity: keep `telegram_user_id` as the key (plan §3 conflict)
The plan keys everything by `auth.users.id` (uuid). The existing tables are keyed by `users.telegram_user_id` (bigint), and the bot's upserts depend on it. **Decision:** keep the bigint as the user key everywhere. New tables use `user_id bigint references users(telegram_user_id)`. A new column `users.auth_user_id uuid unique` links a Supabase Auth account. RLS policies call the helper `public.coach_uid()`, which maps `auth.uid()` → `telegram_user_id`. `coach_settings.telegram_chat_id` is dropped: in a private chat the chat id equals the user id.

### D5. Link codes live in their own table (plan §3 conflict)
The plan puts `link_code` on `coach_settings`, but someone who has just logged in to the PWA has no `users` row yet (no Telegram link), so there's nowhere to store it. **Decision:** `link_codes (code, auth_user_id, expires_at)`. The PWA calls the RPC `create_link_code()` (security definer, 6 random digits, valid 10 min). The bot's `/link 123456` consumes the code and sets `users.auth_user_id`.

### D6. Reuse `weight_entries`, keep its column names
No parallel table. Plan names map to existing ones: `measured_on` → `recorded_at`, `weight_kg` → `weight`. Added: `source text default 'telegram' check in ('telegram','pwa')`, `note text`. The DB check stays at 20–300; the **bot input** now uses the plan's 40–250 range and asks for confirmation on a jump of more than 3 kg.

### D7. Weekly average rounding
Kept exactly as before: mean rounded to 1 decimal. The shared module computes in integer hundredths to avoid float drift, then rounds half up, which matches `Math.round` for positive weights.

### D8. One stats implementation: `shared/stats.mjs`
A pure ES module with no dependencies. The CommonJS bot loads it via dynamic `import()`. The PWA (Vite) imports it directly, and `coach-chat` (Deno) will import it at deploy time. There's no SQL view, so stats logic exists in only one place.

### D9. Existing daily reminder stays as-is in M1
`users.reminder_time` (default 08:00) keeps working as before, except that it's now skipped while `/pause` is active. In M3 it will be folded into `coach_settings.morning_check_time` (the plan's default is 11:00; we'll use whatever time Faisal has set).

### D10. Weekly summary is logged
For coach users (D12), the Saturday summary now also adds counts for minimum days and lifting days, and is logged to `coach_messages` as `weekly_report` (`used_fallback = true` until the M4 DeepSeek report replaces it).

### D11. DeepSeek model
Checked https://api-docs.deepseek.com on 2026-11-12: the current IDs are `deepseek-flash` and `deepseek-v4-pro`. We use `deepseek-flash`, overridable with the `DEEPSEEK_MODEL` env var. If `DEEPSEEK_API_KEY` isn't set, free-text parsing is off and the bot behaves as before (it ignores unknown text).

### D12. The coach is opt-in, per user (plan §2 "single user" conflict)
The plan assumes Faisal is the only user. The live database has **5 Telegram users**: three others have the 08:00 reminder on, and one of them has weigh-ins. **Decision (Faisal, 2026-11-12):** the coach is opt-in. `coach_settings.coach_enabled` defaults to `false`, and `start_weight` / `goal_weight` have no defaults (a check constraint requires both once the coach is enabled).
- **Users who haven't opted in keep the original bot.** That means the original weight reply text, the original 20–300 range (out-of-range plain numbers are still silently ignored), no jump confirmation, the original Saturday summary (`src/legacySummary.js`), no DeepSeek parsing, and no `/link`.
- **What everyone gets:** Arabic-Indic digits, the Riyadh-date fix (D3), Sunday weeks (D2), `/done` / «مشيت», `/gym` / «حديد», `/pause` / `/resume`, and the two new keyboard buttons.
- **Opting in:** `/coach 80` turns it on with goal 80 and start = the latest weigh-in; `/coach 80 112` sets the start explicitly; `/coach off` turns it off; `/coach` alone shows the status or the intro.
- Every coaching job in M3/M4 (nudges, milestones, trend alerts) must check `coach_enabled`.

### D13. PWA login = email + password (plan §7.2 conflict)
The plan specifies email OTP (6-digit code) because magic links open Safari instead of the home-screen app. **Decision (Faisal, 2026-11-12):** plain email + password with Supabase Auth (`signInWithPassword`). The session is stored in the installed app's own storage, so you log in once inside the home-screen app and stay logged in. Account creation and password reset are the only flows that send an email.
- The account is created from the PWA's sign-up screen, where Faisal types his own password. "Confirm email" is off, so sign-up doesn't depend on an email link.
- Sign-ups stay **on**, because watchers (D14) create their own accounts. That's safe: a stranger's account sees nothing: RLS only returns rows for an auth user linked via `/link` to a Telegram account with the coach enabled (D4, D12).
- Password reset sends an email link that opens in Safari. Setting the new password there works, and you then log in again in the app.

### D14. Accountability: a friend watches in the PWA (new, outside the original plan)
The plan listed social features and meal logging as out of scope. **Decision (Faisal, 2026-11-12):** add them as a new milestone, **M2.5 "Watch me"**, built on top of M2's login.
- **Watcher accounts.** The friend signs up in the same PWA (email + password, D13) and enters an invite code that Faisal creates in Settings. Watchers don't need Telegram or the coach. Table `watchers (owner_user_id bigint → users, watcher_auth_user_id uuid → auth.users, created_at)`, plus `watch_invites (code, owner_user_id, expires_at)`. Faisal can remove a watcher at any time.
- **What a watcher can see:** daily weights, weekly averages and the ladder, walks and lifting (`daily_checks`), and meal posts. **Never shown to watchers:** coach messages and chat, settings other than start/goal, and the `ate_out` field. RLS gets a helper `can_view(owner)`, true for the owner or one of their watchers, and it's used in **select-only** policies. Watchers can never write anything.
- **Meal posts.** New table `meal_posts (id, user_id, local_date, posted_at, storage_path, caption, source in ('telegram','pwa'))` and a private bucket `meal-photos` with paths `{telegram_user_id}/{yyyy-mm-dd}/{uuid}.jpg`. Storage RLS: owner can read and write; watchers can read via signed URLs. Posting works either way: send a photo to Mushabbab (coach users only; the caption becomes the post text), or upload from the PWA. Both land in the same feed.
- **Feed screen** for watchers (and Faisal): a day-by-day timeline of weight, walk/lifting badges and meal photos, plus the same chart and ladder as Progress.
- **Missed days.** After **3 days** with no activity, the watcher gets a kind note in the feed («فيصل غايب من ٣ أيام، يمكن يحتاج كلمة منك 👋»), plus a Web Push once M5 exists. It fires at most once per gap and never during `/pause`. This sits alongside the coach's own comeback message to Faisal (M3).

### D15. Flex photos are private by default, shared per photo
**Decision (Faisal, 2026-11-12):** flex photos never reach a watcher automatically.
- Add `flex_photos.shared_with_watchers boolean not null default false` (additive migration). The watcher select policy is `can_view(user_id) and shared_with_watchers`; the owner sees all of them.
- In the Flex tab, each photo has a «يشوفها صاحبي» switch. When it's on, the photo shows up in the watcher feed for that day.
- A side-by-side comparison can be shared to the feed as well as through the share sheet (WhatsApp). Sharing it to the feed stores the rendered image as a flex photo with `shared_with_watchers = true`.
- Storage: separate private bucket `flex-photos` (as in the plan), with watcher read access only through signed URLs that the server creates for shared photos.
- Flex reuses M2.5's photo upload, storage and feed, so it can be built alongside M2.5 instead of waiting for M6.

### D16. Reactions and comments in the watch feed
**Decision (Faisal, 2026-11-12):** watchers can react to and comment on what they see. This is part of M2.5.
- **What can be reacted to or commented on:** meal posts, shared flex photos (D15), and each day card (that day's weight plus walk/lifting badges). A feed item is identified by `(item_kind in ('meal','flex','day'), item_ref)`. `item_ref` is the post id for meals and flex photos, and the local date for days.
- **Tables:**
  - `feed_reactions (owner_user_id, item_kind, item_ref, author_auth_user_id, emoji, created_at)`, with one reaction per author per item (a new tap replaces the old one).
  - `feed_comments (id, owner_user_id, item_kind, item_ref, author_auth_user_id, body text check (length(body) between 1 and 280), created_at)`.
- **Emoji:** a fixed set (🔥 💪 👏 😅 👀) so it stays light. Comments are short text, up to 280 characters.
- **Who can write:** the owner and their watchers (`can_view(owner_user_id)`). Authors can delete their own comments, and the owner can delete any comment on their feed. Watchers still can't change any of the owner's data.
- **Telling Faisal: PWA notifications (Web Push), not Telegram** (Faisal, 2026-11-12). Tapping a notification opens that feed item. Comments are pushed one by one; reactions are batched into at most one push every 30 minutes. If push isn't enabled on any of his devices, nothing goes to Telegram: the app shows an unread badge on the feed tab instead. Watchers get the same: a push when Faisal replies, otherwise the badge.
- **This brings Web Push forward from M5 into M2.5.** It covers VAPID keys, the `push_subscriptions` table (already created in M1), the service-worker push handler, the iOS rules (only after Add to Home Screen, and permission only from a tap on «فعّل التنبيهات»), and removing dead subscriptions on 404/410. Pushes are sent from the Node bot process (D1). M5 then only has to route the coach nudges to push as well.
- The coach's tone rules still apply to anything the bot writes. Comments from friends are shown as written.

### D17. Font: Thmanyah Sans, deployed with the app but never committed (plan §7.1 conflict)
The plan said not to bundle Thmanyah because its licence forbids hosting the font files anywhere except Thmanyah's official source. **Decision (Faisal, 2026-11-12, after being told about the restriction):** use Thmanyah Sans as the PWA font anyway. To limit redistribution:
- The woff2 files (Regular, Medium, Bold) are copied from Faisal's local download into `pwa/public/fonts/thmanyah/`, which is **git-ignored**, so they never reach GitHub.
- Because of that, the PWA is deployed from a local build (`netlify deploy --prod --dir dist`), not from a Netlify git build.
- IBM Plex Sans Arabic (OFL) stays bundled as the fallback. A fresh clone without the Thmanyah files still renders correctly.
- Licence reference: Thmanyah's FAQ (ask.thmanyah.com, "Thmanyah Font for Everyone") allows use in websites and apps, but not uploading or hosting the font files outside the official source.

## Live system check (2026-11-12)
- **Supabase:** project `Fitness-telegram` (`msfxhmswhsfrfurkfjwy`). The live tables match `supabase/schema.sql` exactly; no extra tables or RPCs.
- **Telegram:** `@moshabeb_bot`, no webhook set (long polling), no pending updates, and a weigh-in was logged today, so the deployed bot is running.
- **Data:** Faisal has 88 weigh-ins since 2026-03-06 (97.0 → 111.2, with gaps Sep 7 → Oct 21 → Nov 10). None were logged between 00:00 and 03:00 Riyadh, so the UTC date bug (D3) didn't mis-date any past entries.
- **VPS (Vultr, 64.176.164.36, Ubuntu 22.04, Node 20.20.2 with full ICU, 1 GB RAM):** user `linuxuser`. pm2 runs the bot as **`mshabib-bot`** from **`/home/linuxuser/Qaiyma/mshabeb-fit`** (not `weight-tracker-bot` as the README says). The same pm2 also runs `qaiyma-bot` (a different token) and a stopped `trend-hunter`.
- **Deployed code = commit `b906714`** (Saudi timezone), byte-for-byte. The checkout is at `1e00b55` with uncommitted edits, so it was deployed by copying files, not with `git pull`. It still has `render.yaml`. `fd91d26` (README only) isn't deployed, which doesn't matter.
- **Restart history:** pm2 shows 118,913 restarts. Every one was `409 Conflict: terminated by other getUpdates request`, meaning a second copy of the bot was polling with the same token. It crash-looped from 2026-07-24 until 2026-09-03, then launched once and has stayed up since, connected to Telegram, with no 409s after that. So the other copy is gone. **Never run `npm start` locally while the VPS bot is live**, or it will start fighting again.
- **2026-10-28:** 135 Cloudflare 522 errors from Supabase (temporarily unreachable). The process survived them.
- The pm2 logs aren't rotated (30 MB error log, 19 MB out log). Consider `pm2 install pm2-logrotate`.

## Other notes
- README claims Telegram only delivers bot messages to users active in the last 24 hours. That's not a Telegram rule: a bot can message anyone who has started it and not blocked it. A 403 means blocked. (README left as-is for now.)
- The reply keyboard has a `⏰ التذكير اليومي` button with no handler. Now wired to the same handler as `/reminder`.

## M2 / M2.5 status (2026-11-12)
- **Migration `20261112100000_m2_watch.sql`** applied to live Supabase. RLS checked in a rolled-back transaction: a stranger sees nothing; a watcher sees weights, checks, meals and only *shared* flex photos, can comment and react, and can't read settings, coach messages or `ate_out` or write any data; the owner sees everything.
- **PWA** in `pwa/` (Vite + React + TS, vite-plugin-pwa injectManifest, Recharts, idb-keyval offline queue). App icon and avatar come from `pwa/assets/mushabbab.jpg` (`npm run icons`). A dev-only demo mode (`?demo=owner` / `?demo=watcher`) shows fake data; it's stripped from production builds.
- **Bot**: Telegram photos become meal posts, or private flex photos when the caption starts with «فليكس». `src/notifier.js` sends Web Push for comments (one by one), reactions (at most one push per 30 min per person) and the 3-quiet-days note (outside quiet hours, not while paused).

## Live URLs (2026-11-12)
- **App:** https://mushabbab.faisalalthuwaini.sa. Netlify site `mushabbab-coach`, with DNS on Netlify DNS (zone `faisalalthuwaini.sa`) and a wildcard Let's Encrypt certificate. The old address `mushabbab-coach.netlify.app` 301-redirects here so there's only one origin (home-screen storage, login and push subscriptions are all per origin).
- **Supabase Auth Site URL:** https://mushabbab.faisalalthuwaini.sa ("Confirm email" off).
- **Stay logged in (2026-11-12):** sessions never expire on this project (no time-box, no inactivity timeout, single-session off). The refresh-token reuse interval was raised from 10 s to the maximum **300 s**, so an iPhone that freezes the PWA mid-refresh doesn't trigger reuse detection and a forced logout. In the app, the session is mirrored in localStorage **and** IndexedDB (either restores the other), persistent storage is requested after login, and auto-refresh restarts when the app comes back to the foreground. Only «تسجيل خروج» ends a session.

## Deploy order for M2
1. Supabase dashboard → Authentication → Sign In / Providers → Email: turn **"Confirm email" off** (D13).
2. VPS: add `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` to `.env` (same values as the local `.env`), then `git pull`, `npm install`, `pm2 restart mshabib-bot`.
3. PWA: `cd pwa && npm run build && npx netlify deploy --prod --dir dist` (needs `npx netlify login` once). `pwa/.env.local` holds only public values.
4. Faisal opens the Netlify URL in Safari → Add to Home Screen → creates his account → gets a link code → `/link 123456` in Telegram.
5. Faisal: Settings → «ادعُ صاحب» → send the code; the friend signs up in the same app and enters it.

## Deploy order for M1
1. Run `supabase/migrations/20261112000000_coach_m1.sql` in the Supabase SQL editor.
2. On the VPS, in `/home/linuxuser/Qaiyma/mshabeb-fit`: discard the copied-in edits (they equal `b906714`, which is already in history), check out the new branch, `npm install`, add `DEEPSEEK_API_KEY` to `.env` (optional), then `pm2 restart mshabib-bot`.
3. Faisal sends `/coach 80 112` to the bot to turn the coach on for himself.

The migration must go first: the new code writes `weight_entries.source` and reads `coach_settings`.
