const cron = require('node-cron');
const weightService = require('./services/weight.js');
const { getMotivational } = require('./messages.js');

function startReminderScheduler(bot) {
  cron.schedule('* * * * *', async () => {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();

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

  console.log('Reminder scheduler started (runs every minute, UTC).');
}

module.exports = { startReminderScheduler };
