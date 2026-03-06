const weightService = require('../services/weight.js');
const chartService = require('../services/chart.js');
const { getTrendMessage } = require('../messages.js');

async function handleProgress(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  try {
    const [todayWeight, weekly, entries] = await Promise.all([
      weightService.getTodayWeight(from.id),
      weightService.getWeeklyAverages(from.id),
      weightService.getRecentEntries(from.id, 14),
    ]);

    let text = '📊 *تقدمك*\n\n';
    if (todayWeight != null) {
      text += `اليوم: *${todayWeight}* كغ\n`;
    } else {
      text += `اليوم: _لا يوجد تسجيل_\n`;
    }
    if (weekly.thisWeekAvg != null) {
      text += `متوسط هذا الأسبوع: *${weekly.thisWeekAvg}* كغ (${weekly.thisWeekCount} تسجيل)\n`;
    } else {
      text += `متوسط هذا الأسبوع: _لا بيانات_\n`;
    }
    if (weekly.lastWeekAvg != null) {
      text += `متوسط الأسبوع الماضي: *${weekly.lastWeekAvg}* كغ (${weekly.lastWeekCount} تسجيل)\n`;
    } else {
      text += `متوسط الأسبوع الماضي: _لا بيانات_\n`;
    }

    if (weekly.thisWeekAvg != null && weekly.lastWeekAvg != null) {
      const diff = weekly.thisWeekAvg - weekly.lastWeekAvg;
      const sign = diff > 0 ? '+' : '';
      text += `\nمقارنة أسبوع بأسبوع: ${sign}${diff} كغ\n`;
    }

    const trendMsg = getTrendMessage(weekly.thisWeekAvg, weekly.lastWeekAvg);
    text += `\n${trendMsg}`;

    const chartUrl = chartService.getChartUrl(entries);
    if (chartUrl) {
      try {
        await ctx.replyWithPhoto(chartUrl, { caption: text, parse_mode: 'Markdown' });
      } catch (err) {
        console.error('Chart photo failed:', err.message);
        await ctx.reply(text + '\n\n_(تعذّر تحميل الرسم البياني)_', { parse_mode: 'Markdown' });
      }
    } else {
      text += '\n\n_سجّل وزنك يومين على الأقل لرؤية الرسم البياني._';
      await ctx.reply(text, { parse_mode: 'Markdown' });
    }
  } catch (e) {
    console.error('progress error:', e);
    await ctx.reply('حدث خطأ. حاول مرة أخرى.');
  }
}

module.exports = { handleProgress };
