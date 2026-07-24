const cron = require('node-cron');
const weightService = require('./services/weight.js');
const { getMotivational, getTrendMessage } = require('./messages.js');

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
        const weekly = await weightService.getWeeklyAverages(telegramUserId);

        // Skip users with no data in both weeks
        if (
          (weekly.thisWeekAvg == null || weekly.thisWeekCount === 0) &&
          (weekly.lastWeekAvg == null || weekly.lastWeekCount === 0)
        ) {
          continue;
        }

        let text = '📊 *ملخص أسبوعك*\n\n';
        text += `متوسط هذا الأسبوع: ${
          weekly.thisWeekAvg != null ? `*${weekly.thisWeekAvg}* كغ (${weekly.thisWeekCount} تسجيل)` : '_لا بيانات_'
        }\n`;
        text += `متوسط الأسبوع الماضي: ${
          weekly.lastWeekAvg != null ? `*${weekly.lastWeekAvg}* كغ (${weekly.lastWeekCount} تسجيل)` : '_لا بيانات_'
        }\n`;

        if (weekly.thisWeekAvg != null && weekly.lastWeekAvg != null) {
          const diff = weekly.thisWeekAvg - weekly.lastWeekAvg;
          const sign = diff > 0 ? '+' : '';
          text += `\nالفرق بين هذا الأسبوع والماضي: ${sign}${diff} كغ\n`;
        }

        text += `\n${getTrendMessage(weekly.thisWeekAvg, weekly.lastWeekAvg)}`;

        await bot.telegram.sendMessage(telegramUserId, text, { parse_mode: 'Markdown' });
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
