const weightService = require('../services/weight.js');
const { getTrendMessage, getMotivational } = require('../messages.js');

async function handleCompareWeek(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  try {
    const weekly = await weightService.getWeeklyAverages(from.id);
    let text = '📈 *أسبوع بأسبوع*\n\n';
    if (weekly.thisWeekAvg == null && weekly.lastWeekAvg == null) {
      text += 'لا توجد بيانات كافية. سجّل وزنك أياماً هذا الأسبوع والأسبوع الماضي.';
      return ctx.reply(text, { parse_mode: 'Markdown' });
    }
    text += `متوسط هذا الأسبوع: ${weekly.thisWeekAvg != null ? `*${weekly.thisWeekAvg}* كغ` : '_لا بيانات_'}\n`;
    text += `متوسط الأسبوع الماضي: ${weekly.lastWeekAvg != null ? `*${weekly.lastWeekAvg}* كغ` : '_لا بيانات_'}\n`;
    if (weekly.thisWeekAvg != null && weekly.lastWeekAvg != null) {
      const diff = weekly.thisWeekAvg - weekly.lastWeekAvg;
      const sign = diff > 0 ? '+' : '';
      text += `\nالفرق: ${sign}${diff} كغ\n`;
    }
    text += `\n${getTrendMessage(weekly.thisWeekAvg, weekly.lastWeekAvg)}`;
    return ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('compare week error:', e);
    return ctx.reply('حدث خطأ. حاول مرة أخرى.');
  }
}

async function handleCompareDay(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  try {
    const { earlier, later } = await weightService.getDayOverDay(from.id);
    let text = '📉 *يوم بيوم*\n\n';
    if (!earlier || !later) {
      text += 'تحتاج يومين مسجّلين على الأقل للمقارنة. استمر بالتسجيل!';
      return ctx.reply(text, { parse_mode: 'Markdown' });
    }
    text += `${earlier.date}: *${earlier.weight}* كغ\n`;
    text += `${later.date}: *${later.weight}* كغ\n`;
    const diff = later.weight - earlier.weight;
    const sign = diff > 0 ? '+' : '';
    text += `\nالتغيّر: ${sign}${diff} كغ\n`;
    text += `\n${getMotivational()}`;
    return ctx.reply(text, { parse_mode: 'Markdown' });
  } catch (e) {
    console.error('compare day error:', e);
    return ctx.reply('حدث خطأ. حاول مرة أخرى.');
  }
}

async function handleCompare(ctx) {
  const text = (ctx.message?.text || '').trim().toLowerCase();
  if (text.includes(' day') || text === '/compare day') {
    return handleCompareDay(ctx);
  }
  return handleCompareWeek(ctx);
}

module.exports = { handleCompare, handleCompareWeek, handleCompareDay };
