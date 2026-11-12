const cron = require('node-cron');
const weightService = require('./services/weight.js');
const { getMotivational } = require('./messages.js');
const coach = require('./services/coach.js');

const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // Saudi Arabia is UTC+3, no DST

function startReminderScheduler(bot) {
  // Daily reminder every minute (checks who يجب أن يرسَل لهم التذكير في هذه الدقيقة)
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const ksaNow = new Date(now.getTime() + KSA_OFFSET_MS);
    const hour = ksaNow.getUTCHours();
    const minute = ksaNow.getUTCMinutes();

    let userIds = [];
    try {
      userIds = await weightService.getUsersWithReminderDue(hour, minute);
    } catch (e) {
      console.error('scheduler: getUsersWithReminderDue error', e);
      return;
    }

    for (const telegramUserId of userIds) {
      try {
        if (await coach.isPaused(telegramUserId).catch(() => false)) continue; // /pause
        await bot.telegram.sendMessage(
          telegramUserId,
          `⏰ وقت تسجيل وزنك!\n\n${getMotivational()}`
        );
      } catch (e) {
        if (e.response?.error_code === 403) {
          console.warn('Reminder not delivered (user may have blocked or not chatted in 24h):', telegramUserId);
        } else {
          console.error('scheduler: sendMessage error', telegramUserId, e.message);
        }
      }
    }
  });

  console.log('Reminder scheduler started (runs every minute, checks against Saudi Arabia time UTC+3).');

  // Weekly summary every Saturday at 21:00 Saudi Arabia time (Sat/Fri is the Saudi weekend)
  // Cron format: minute hour day-of-month month day-of-week (runs on server clock, assumed UTC)
  // 21:00 KSA (UTC+3) = 18:00 UTC, Saturday = day-of-week 6
  cron.schedule('0 18 * * 6', async () => {
    console.log('Running weekly summary job (Saturday 21:00 Saudi Arabia time)');
    let userIds = [];

    try {
      userIds = await weightService.getAllUserIds();
    } catch (e) {
      console.error('weekly summary: getAllUserIds error', e);
      return;
    }

    for (const telegramUserId of userIds) {
      try {
        if (!(await coach.isCoachEnabled(telegramUserId))) {
          // Original summary for users who haven't opted in (DECISIONS.md D12)
          const { buildLegacyWeeklySummary } = require('./legacySummary.js');
          const legacy = await buildLegacyWeeklySummary(telegramUserId);
          if (legacy) await bot.telegram.sendMessage(telegramUserId, legacy, { parse_mode: 'Markdown' });
          continue;
        }

        // Lazy require avoids a circular import (handlers/coach → handlers/weight → …).
        const { buildReport } = require('./handlers/coach.js');
        const { text, week, prev } = await buildReport(telegramUserId, 'current');

        // Skip users with no data in both weeks (same rule as before)
        if (week.n_weighins === 0 && (!prev || prev.n_weighins === 0)) continue;

        await bot.telegram.sendMessage(telegramUserId, text);
        await coach.logMessage({
          userId: telegramUserId,
          kind: 'weekly_report',
          content: text,
          data: { week, prev },
          channels: ['telegram'],
          usedFallback: true, // template report until M4
          weekStart: week.week_start,
        });
      } catch (e) {
        if (e.response?.error_code === 403) {
          console.warn('weekly summary not delivered (user may have blocked or not chatted in 24h):', telegramUserId);
        } else {
          console.error('weekly summary: sendMessage error', telegramUserId, e.message);
        }
      }
    }
  });

  console.log('Weekly summary scheduler started (Saturdays 21:00 Saudi Arabia time).');
}

module.exports = { startReminderScheduler };
