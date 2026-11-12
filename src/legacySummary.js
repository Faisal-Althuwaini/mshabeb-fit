// The original weekly summary text, unchanged, for users who haven't opted in to the coach
// (DECISIONS.md D12). Returns null when there's no data in either week (original skip rule).
const weightService = require('./services/weight.js');
const { getTrendMessage } = require('./messages.js');

async function buildLegacyWeeklySummary(telegramUserId) {
  const weekly = await weightService.getWeeklyAverages(telegramUserId);
  if (
    (weekly.thisWeekAvg == null || weekly.thisWeekCount === 0) &&
    (weekly.lastWeekAvg == null || weekly.lastWeekCount === 0)
  ) {
    return null;
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
  return text;
}

module.exports = { buildLegacyWeeklySummary };
