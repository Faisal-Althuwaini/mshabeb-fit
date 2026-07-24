# Weight Tracker Bot

A Telegram bot that tracks your weight the way that actually reflects progress: by the week, not by the day.

## The problem

Body weight swings by a kilogram or more from one day to the next — water retention, sodium, hormones, when you last ate, even how much you slept. None of that is fat gain or loss, but if you step on the scale daily and watch the number bounce around, it feels like progress is random, or worse, like you're failing. That noise is exactly what makes people give up: they weigh in, see an increase that has nothing to do with their actual trend, and lose motivation.

The fix isn't to stop weighing in — it's to stop judging progress from single data points. A weekly average smooths out the day-to-day noise and reveals the real trend underneath it. That's the whole premise of this bot: log your weight daily (it only takes a text message), and let it do the averaging and week-over-week comparison for you, so what you see is signal, not noise.

## What it does

- **Effortless logging** — send a bare number (`72.5`) or `/weight 72.5` in the chat; either logs today's weight
- **Weekly averages, front and center** — `/progress` shows today's weight alongside this week's average and a 14-day trend chart, so a single day never overshadows the bigger picture
- **Week-over-week comparison** — `/compare week` tells you whether your weekly average is actually moving, up or down, compared to last week; `/compare day` is there too, but the weekly view is the one that matters
- **Daily reminders** — set a time with `/reminder 08:00`, and the bot nudges you if you haven't logged yet; consistent logging is what makes the weekly average meaningful in the first place
- **Automatic weekly recap** — a summary comparing this week's average to last week's, delivered without you having to ask
- **Motivation on demand** — `/motivate` for a random nudge when the day-to-day number is tempting you to read too much into it

## How it's built

| Layer | Choice | Why |
|---|---|---|
| Bot framework | [Telegraf](https://telegraf.js.org) | Mature, well-documented Telegram bot library for Node.js |
| Database | [Supabase](https://supabase.com) | Managed Postgres with a simple JS client — no server to run for the DB itself |
| Scheduling | [node-cron](https://www.npmjs.com/package/node-cron) | In-process cron for reminders and the weekly summary, no external scheduler needed |
| Charts | [QuickChart](https://quickchart.io) | Renders the progress chart as an image URL — no chart library or canvas dependency |
| Process management | [pm2](https://pm2.keymetrics.io) | Keeps the bot alive and auto-restarting on a VPS |

The bot runs on long polling (no public URL or webhook required), which is why it deploys cleanly to a plain VPS process manager like pm2 instead of needing a web-facing host.

## Setup

### 1. Create your Telegram bot

1. Open Telegram and message [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts.
3. Copy the bot token it gives you (looks like `123456:ABC-DEF...`).

### 2. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the contents of [`supabase/schema.sql`](supabase/schema.sql) to create the `users` and `weight_entries` tables.
3. Go to **Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

   Keep the service role key secret — it belongs only in this bot's server-side environment, never in client code.

### 3. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

- `BOT_TOKEN` — your Telegram bot token
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service role key

### 4. Install and run

```bash
npm install
npm start
```

For production, keep it running with pm2 instead:

```bash
pm2 start src/index.js --name weight-tracker-bot
pm2 save
```

## Good to know

**Reminders and the weekly summary run on Saudi Arabia time (UTC+3).** The weekly recap lands Saturday evening, matching the Friday/Saturday weekend rather than a Sunday-close-of-week.

**Telegram's 24-hour rule.** Telegram only lets bots message users who've messaged the bot within the last 24 hours. If someone hasn't opened the chat in a day, a scheduled reminder or weekly summary simply won't be delivered — there's no way around this on Telegram's side, so users need to open the bot at least once a day for reminders to land.

## Project structure

- `src/index.js` — bot setup, command and button registration, HTTP fallback
- `src/config.js` — environment variable loading and validation
- `src/supabase.js` — Supabase client
- `src/scheduler.js` — cron jobs for daily reminders and the weekly summary
- `src/handlers/` — one handler per command (start, weight, progress, compare, motivate, reminder)
- `src/services/weight.js` — weight and user data access
- `src/services/chart.js` — builds the QuickChart progress chart URL
- `src/messages.js` — motivational and trend message pools
- `supabase/schema.sql` — database schema to run in the Supabase SQL Editor

## License

MIT
