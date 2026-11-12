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

## Deploy order for M1
1. Run `supabase/migrations/20261112000000_coach_m1.sql` in the Supabase SQL editor.
2. On the VPS, in `/home/linuxuser/Qaiyma/mshabeb-fit`: discard the copied-in edits (they equal `b906714`, which is already in history), check out the new branch, `npm install`, add `DEEPSEEK_API_KEY` to `.env` (optional), then `pm2 restart mshabib-bot`.
3. Faisal sends `/coach 80 112` to the bot to turn the coach on for himself.

The migration must go first: the new code writes `weight_entries.source` and reads `coach_settings`.
