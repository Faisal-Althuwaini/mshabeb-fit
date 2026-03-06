const weightService = require('../services/weight.js');
const { getMotivational } = require('../messages.js');

async function handleMotivate(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  try {
    const weekly = await weightService.getWeeklyAverages(from.id);
    let text = getMotivational();
    if (weekly.thisWeekCount != null && weekly.thisWeekCount > 0) {
      text += `\n\nسجّلت ${weekly.thisWeekCount} يوم هذا الأسبوع. استمر!`;
    }
    return ctx.reply(text);
  } catch (e) {
    console.error('motivate error:', e);
    return ctx.reply(getMotivational());
  }
}

module.exports = { handleMotivate };
