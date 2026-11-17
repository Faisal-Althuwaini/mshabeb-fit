# Mushabbab (مشبب)

An Arabic fitness coach that judges progress by the **week, not the day**. It started as a Telegram weight bot and is now app-first: an installable web app (PWA) with an AI coach, a friend who keeps you honest, and steps, sleep and workouts that arrive on their own.

Live at **[mushabbab.faisalalthuwaini.sa](https://mushabbab.faisalalthuwaini.sa)**.

## The idea

Body weight swings by a kilo or more from one day to the next (water, salt, sleep, when you last ate). Judge yourself by one morning and progress looks random, and that is when people quit. Mushabbab averages your weigh-ins per week (Sunday to Saturday, Riyadh time) and compares weeks, so what you see is the real trend. Next to it sits one rule that keeps the habit alive: **don't miss twice**. On a bad day, the bare minimum («أقل شي») still counts.

## What it does

**Today**
- Log your weight in one tap, in Arabic or Latin digits (`١١٢٫٤` or `112.4`).
- Tick «أقل شي» (the minimum day) and «حديد» (lifting). Both can also tick themselves (see Health sync).
- Steps meter against your goal, last night's sleep, and the week as dots. Forgot a day? Log any past day.

**Progress**
- Weekly averages, change against last week, a streak, and a «ladder» of the next weight milestones since you started.
- Monthly summary image (before/after photos, weight change, measurements, streaks), ready for WhatsApp or posting to your friend.

**Flex**
- Progress photos (up to 4 per post, carousel), weight filled in from the latest weigh-in, and optional body measurements (waist, chest, arm and others).
- Share each post with your friend, or keep it private.

**Coach (AI)**
- Chat with مشبب, who knows your numbers (weights, streaks, steps, sleep, workouts). Runs through OpenRouter on the cheapest capable model, with a fallback model. 30 messages a day.
- Smart nudges (morning, evening, missed-day rescue), a weekly report and an early warning if the trend turns. Templates take over if the AI is down.

**Friend (watcher)**
- Invite a friend by code. They see your feed (meals, check-ins, shared photos, measurements), react, comment and get notifications. You see «👀 شافه» when they've seen something.
- Rename or remove a watcher at any time.

**Health sync**
- **Google Health API** (Fitbit, plus Hevy via Apple Health): link once with Google. Steps, sleep and strength workouts sync every 20 minutes. Reaching the step goal ticks «أقل شي»; 20+ minutes of strength ticks «حديد». Duplicate sessions (Hevy + Fitbit auto-detect) are merged.
- **Apple Health Shortcut** (fallback): a private token lets an iPhone Shortcut post workouts.

**App**
- Installable PWA, dark mode, RTL Arabic with the Thmanyah typeface, web push notifications, opens instantly from a device cache, works offline (writes queue until you're back online), and stays signed in.
- The original Telegram bot still works for weight logging and reminders.

## How it's built

| Part | Choice |
|---|---|
| App | React + TypeScript + Vite, `vite-plugin-pwa` (custom service worker for push), hosted on Netlify |
| Data | Supabase Postgres (Mumbai) with row-level security; one RPC (`get_bundle`) loads a whole screen |
| Auth | Supabase email + password; the Telegram account is linked with a one-time code |
| Server logic | Supabase Edge Functions: `coach-chat`, `google-health`, `health-sync` |
| Bot + jobs | Node.js, Telegraf, node-cron on a VPS under pm2 (nudges, weekly report, Google Health sync) |
| AI | OpenRouter (`deepseek/deepseek-v4.1-flash`, fallback `openai/gpt-oss-120b`) |
| Notifications | Web Push (VAPID) |

The stats and coaching logic is written once in `shared/` and used by the bot, the app and the edge functions (`scripts/sync-shared.sh` copies it; a test fails if the copies drift). Every design decision is logged in [`DECISIONS.md`](DECISIONS.md).

## Project structure

- `pwa/` — the app (`src/screens/` Today, Progress, Coach, Feed, Flex, Settings; `src/lib/` data, stats, offline queue)
- `src/` — bot and scheduled jobs (`coachTick.js` nudges, milestones, weekly report and Google sync; `coachAI.js`; `notifier.js`; `handlers/`)
- `shared/` — `stats.mjs` and `coach.mjs`, the single source for weekly averages, streaks, the ladder and coach prompts
- `supabase/schema.sql` + `supabase/migrations/` — the database, applied in order
- `supabase/functions/` — edge functions (`_shared/` is generated from `shared/`)
- `test/` — `npm test`

## Setup

1. **Supabase:** create a project, run `supabase/schema.sql`, then every file in `supabase/migrations/` in order.
2. **Bot / jobs:** `cp .env.example .env` and fill in `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, the VAPID keys (`npx web-push generate-vapid-keys`) and, optionally, `OPENROUTER_API_KEY`. Then `npm install` and `pm2 start src/index.js --name mshabib-bot`.
3. **App:** `cp pwa/.env.example pwa/.env.local` with the public URL, anon key and VAPID public key. Then `cd pwa && npm install && npm run build && npx netlify deploy --prod --dir dist`. The Thmanyah font files are not in git; put them in `pwa/public/fonts/`.
4. **Edge functions:** `npm run deploy:chat`, `npm run deploy:health`, `npm run deploy:google`. Secrets on the Supabase project: `OPENROUTER_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
5. **Google Health (optional):** in Google Cloud enable the Google Health API, add the scopes `googlehealth.activity_and_fitness.readonly` and `googlehealth.sleep.readonly`, publish the consent screen to *In production* (in *Testing* the link expires after 7 days), and create a Web OAuth client with the redirect URI `https://<project-ref>.supabase.co/functions/v1/google-health`.

## License

MIT
