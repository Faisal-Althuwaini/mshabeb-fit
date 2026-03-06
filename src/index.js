const express = require('express');
const { Telegraf } = require('telegraf');
const { getConfig } = require('./config.js');
const { startReminderScheduler } = require('./scheduler.js');
const { handleStart } = require('./handlers/start.js');
const { handleWeightCommand, handlePlainNumber } = require('./handlers/weight.js');
const { handleProgress } = require('./handlers/progress.js');
const { handleCompare } = require('./handlers/compare.js');
const { handleMotivate } = require('./handlers/motivate.js');
const { handleReminder } = require('./handlers/reminder.js');

const { BOT_TOKEN } = getConfig();
const bot = new Telegraf(BOT_TOKEN);

bot.start(handleStart);
bot.command('weight', handleWeightCommand);
bot.command('log', handleWeightCommand);
bot.command('progress', handleProgress);
bot.command('stats', handleProgress);
bot.command('compare', handleCompare);
bot.command('motivate', handleMotivate);
bot.command('reminder', handleReminder);

bot.on('text', async (ctx, next) => {
  const text = (ctx.message?.text || '').trim();
  if (/^\d+([.,]\d+)?$/.test(text)) {
    return handlePlainNumber(ctx);
  }
  return next();
});

bot.catch((err, ctx) => {
  console.error('Bot error', err);
  ctx.reply('حدث خطأ. حاول مرة أخرى.').catch(() => {});
});

startReminderScheduler(bot);

// HTTP server so Render runs as Web Service and Supabase cron can ping to keep it awake
const app = express();
app.get('/', (req, res) => res.send('OK'));
app.get('/health', (req, res) => res.send('OK'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log('Keep-alive server listening on port', port);
});

async function launchWithRetry(maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await bot.launch();
      console.log('Weight tracker bot is running (polling).');
      return;
    } catch (err) {
      const isTimeout = err.code === 'ETIMEDOUT' || err.message?.includes('ETIMEDOUT');
      console.error(`Launch attempt ${attempt}/${maxAttempts} failed:`, err.message || err.code);
      if (attempt < maxAttempts && isTimeout) {
        const delay = attempt * 5000;
        console.log(`Retrying in ${delay / 1000}s...`);
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

launchWithRetry().catch((err) => {
  console.error('Bot could not start:', err.message);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
