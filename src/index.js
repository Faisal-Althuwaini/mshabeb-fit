const express = require('express');
const { Telegraf } = require('telegraf');
const { getConfig } = require('./config.js');
const { startReminderScheduler } = require('./scheduler.js');
const { handleStart, commandsInlineKeyboard, mainReplyKeyboard } = require('./handlers/start.js');
const { handleWeightCommand, handlePlainNumber } = require('./handlers/weight.js');
const { handleProgress } = require('./handlers/progress.js');
const { handleCompare, handleCompareWeek, handleCompareDay } = require('./handlers/compare.js');
const { handleMotivate } = require('./handlers/motivate.js');
const { handleReminder, getReminder, setReminder } = require('./handlers/reminder.js');

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
bot.command('menu', async (ctx) => {
  await ctx.reply('اختر أمراً من هذه القائمة:', commandsInlineKeyboard());
  return ctx.reply('يمكنك أيضاً استخدام الأزرار في الأسفل:', mainReplyKeyboard());
});

bot.on('text', async (ctx, next) => {
  const text = (ctx.message?.text || '').trim();
  if (/^\d+([.,]\d+)?$/.test(text)) {
    return handlePlainNumber(ctx);
  }
  return next();
});

bot.hears('➕ سجّل وزن', (ctx) =>
  ctx.reply('أرسل وزنك هكذا:\n/weight 72.5\n\nأو أرسل الرقم فقط مثل: 72.5')
);

bot.hears('📊 التقدم', (ctx) => handleProgress(ctx));
bot.hears('📈 مقارنة أسبوع', (ctx) => handleCompareWeek(ctx));
bot.hears('📉 مقارنة يوم', (ctx) => handleCompareDay(ctx));
bot.hears('🔥 تحفيز', (ctx) => handleMotivate(ctx));
bot.hears('📋 القائمة الرئيسية', async (ctx) => {
  await ctx.reply('اختر أمراً من هذه القائمة:', commandsInlineKeyboard());
  return ctx.reply('يمكنك أيضاً استخدام الأزرار في الأسفل:', mainReplyKeyboard());
});

function safeAnswerCbQuery(ctx) {
  return ctx.answerCbQuery?.().catch(() => {});
}

bot.action('cmd_weight', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return ctx.reply('أرسل وزنك هكذا:\n/weight 72.5\n\nأو أرسل الرقم فقط مثل: 72.5');
});

bot.action('cmd_progress', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return handleProgress(ctx);
});

bot.action('cmd_compare_week', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return handleCompareWeek(ctx);
});

bot.action('cmd_compare_day', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return handleCompareDay(ctx);
});

bot.action('cmd_motivate', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  return handleMotivate(ctx);
});

bot.action('cmd_reminder', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  const current = await getReminder(from.id);
  if (current.enabled && current.time) {
    return ctx.reply(
      `التذكير اليومي مضبوط على الساعة ${current.time} (بتوقيت السعودية).\n\n` +
        'لتغيير الموعد: /reminder الساعة:الدقيقة (مثلاً 08:00)\n' +
        'للإيقاف: /reminder off'
    );
  }

  return ctx.reply(
    'ضبط تذكير يومي لتسجيل وزنك.\n\n' +
      'الاستخدام: /reminder الساعة:الدقيقة (مثلاً 08:00)\n' +
      'التوقيت بتوقيت السعودية (UTC+3). مثال: 08:00 = الثامنة صباحاً بتوقيت السعودية.\n\n' +
      'ملاحظة: تيليجرام يوصّل الرسائل فقط لمَن تفاعل مع البوت خلال آخر 24 ساعة.'
  );
});

bot.action('cmd_reminder_off', async (ctx) => {
  await safeAnswerCbQuery(ctx);
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  try {
    await setReminder(from.id, null, false);
    return ctx.reply('تم إيقاف التذكير اليومي.');
  } catch (e) {
    console.error('reminder off error:', e);
    return ctx.reply('حدث خطأ.');
  }
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
