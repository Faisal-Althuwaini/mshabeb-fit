# Telegram Weight Tracker Bot

A Telegram bot that tracks your daily weight, shows weekly averages, week-over-week and day-over-day comparisons, weight charts, and sends daily reminders and motivational messages. Data is stored in Supabase.

## Features

- **Log weight** — `/weight 72.5` or send a number like `72.5` to log for today
- **Progress** — `/progress` or `/stats` for today's weight, weekly averages, and a chart (last 14 days)
- **Compare** — `/compare week` (week vs week) or `/compare day` (last two days)
- **Motivation** — `/motivate` for a random motivational message
- **Daily reminder** — `/reminder 08:00` to get a nudge at 8:00 AM (UTC). Use `/reminder off` to disable.

## Setup

### 1. Telegram bot token

1. Open Telegram and search for [@BotFather](https://t.me/BotFather).
2. Send `/newbot` and follow the prompts.
3. Copy the bot token (e.g. `123456:ABC-DEF...`).

### 2. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run the contents of `supabase/schema.sql` to create the `users` and `weight_entries` tables.
3. Go to **Settings → API**. Copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role** key (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY`  
   Keep the service role key secret and only use it server-side (this bot).

### 3. Environment

```bash
cp .env.example .env
```

Edit `.env` and set:

- `BOT_TOKEN` — your Telegram bot token
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — your Supabase service role key

### 4. Install and run

```bash
npm install
npm start
```

The bot runs with long polling. For production you can switch to webhooks (see Telegraf docs).

## Deploy on Render (Web Service + Supabase cron keep-alive)

على الطبقة المجانية، Render يوقف الخدمة بعد ~10 دقائق بدون طلبات. نرفع البوت كـ **Web Service** ونستخدم **Supabase Cron** ليرسل طلباً للبوت كل 5 دقائق فيبقى شغالاً 24/7.

### 1. رفع البوت على Render كـ Web Service

1. **ادفع الكود لـ GitHub** (إن لم يكن مرفوعاً).
2. ادخل [render.com](https://render.com) → **New +** → **Web Service**.
3. اختر ريبو المشروع. إذا استخدمت `render.yaml` اختر **Apply**.
4. من **Environment** أضف: `BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
5. **Create Web Service**. بعد النشر انسخ عنوان التطبيق (مثلاً `https://mashbub-weight-bot.onrender.com`).

### 2. تفعيل Keep-Alive عبر Supabase Cron

لكي لا يوقف Render الخدمة، نحتاج طلباً دورياً لرابط البوت (مثلاً كل 5 دقائق).

**الطريقة: Edge Function + Cron Trigger**

1. في مشروع Supabase: **Edge Functions** → **Create a new function**.
2. اسم الدالة مثلاً `ping-render`. انسخ محتوى `supabase/functions/ping-render/index.ts` من المشروع.
3. أضف **Secret**: **Settings** → **Edge Functions** → **Secrets** → أضف `RENDER_APP_URL` = عنوان تطبيقك على Render (مثلاً `https://mashbub-weight-bot.onrender.com`).
4. **Cron Trigger**: في **Database** → **Cron Jobs** (أو من جدولة Edge Function إن وُجدت)، جدول الدالة كل **5 دقائق**، مثلاً:
   - Cron expression: `*/5 * * * *`  
   أو استخدم واجهة Supabase لجدولة استدعاء الدالة `ping-render` كل 5 دقائق.

بهذا يصل طلب إلى `https://your-app.onrender.com/health` كل 5 دقائق ويبقى البوت يعمل دون إيقاف.

**بديل:** يمكنك استخدام خدمة مجانية مثل [cron-job.org](https://cron-job.org) أو [UptimeRobot](https://uptimerobot.com): أنشئ مهمة تفتح الرابط `https://your-app.onrender.com/health` كل 5 دقائق.

## Daily reminder (Telegram 24h rule)

Telegram only allows bots to send messages to users who have messaged the bot in the **last 24 hours**. If a user has not opened a chat with the bot in 24 hours, the reminder will not be delivered. Tell your users to open the bot at least once per day if they want reminders.

## Project structure

- `src/index.js` — Bot setup and command registration
- `src/config.js` — Environment config
- `src/supabase.js` — Supabase client
- `src/scheduler.js` — Cron job for daily reminders
- `src/handlers/` — Command handlers (start, weight, progress, compare, motivate, reminder)
- `src/services/weight.js` — Weight and user DB logic
- `src/services/chart.js` — QuickChart URL for progress chart
- `src/messages.js` — Motivational and trend messages
- `supabase/schema.sql` — DB schema to run in Supabase SQL Editor

## License

MIT
