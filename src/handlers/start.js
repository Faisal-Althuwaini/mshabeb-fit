const { ensureUser } = require('../services/weight.js');
const { getReminder, setReminder } = require('./reminder.js');
const { Markup } = require('telegraf');

const DEFAULT_REMINDER_TIME = '08:00'; // 8:00 AM Saudi Arabia time (UTC+3) daily

function commandsInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ سجّل وزن', 'cmd_weight')],
    [Markup.button.callback('📊 التقدم', 'cmd_progress')],
    [
      Markup.button.callback('📈 مقارنة أسبوع', 'cmd_compare_week'),
      Markup.button.callback('📉 مقارنة يوم', 'cmd_compare_day'),
    ],
    [
      Markup.button.callback('⏰ التذكير', 'cmd_reminder'),
      Markup.button.callback('🛑 إيقاف التذكير', 'cmd_reminder_off'),
    ],
    [Markup.button.callback('🔥 تحفيز', 'cmd_motivate')],
  ]);
}

function mainReplyKeyboard() {
  return Markup.keyboard([
    ['✅ مشيت', '🏋️ حديد'],
    ['➕ سجّل وزن', '📊 التقدم'],
    ['📈 مقارنة أسبوع', '📉 مقارنة يوم'],
    ['🔥 تحفيز', '⏰ التذكير اليومي'],
    ['📋 القائمة الرئيسية'],
  ]).resize();
}

async function handleStart(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  try {
    await ensureUser(require('../supabase.js').getSupabase(), from.id, from);
  } catch (e) {
    console.error('ensureUser error:', e);
    return ctx.reply('حدث خطأ. حاول لاحقاً.');
  }

  try {
    const current = await getReminder(from.id);
    if (!current.enabled || !current.time) {
      await setReminder(from.id, DEFAULT_REMINDER_TIME, true);
    }
  } catch (e) {
    console.error('setDefaultReminder error:', e);
  }

  const welcome = `
مرحباً في مشبب — متتبع الوزن!

سأذكّرك كل يوم الساعة 8:00 صباحاً (بتوقيت السعودية) بتسجيل وزنك. لتغيير الموعد: /reminder الساعة:الدقيقة (مثلاً 09:30). للإيقاف: /reminder off

ماذا يمكنك أن تفعل:

/weight 72.5 — سجّل وزنك (بالكيلو). أو أرسل الرقم فقط مثل 72.5
/progress — شاهد تقدمك: وزن اليوم، متوسط الأسبوع، والرسم البياني
/compare week — قارن متوسط هذا الأسبوع بالأسبوع الماضي
/compare day — قارن آخر يومين مسجّلين
/motivate — رسالة تحفيزية عشوائية
/reminder — عرض أو تغيير موعد التذكير اليومي
/done أو «مشيت» — سويت يومك الأدنى (مشي ١٥ دقيقة)
/gym أو «حديد» — تمرنت حديد (/gym anterior أو /gym posterior)
/pause 5 — وقّف التذكيرات ٥ أيام (سفر أو مرض)، و /resume ترجعها
/report — ملخص الأسبوع الحين
/coach — فعّل مشبب المدرب (تذكيرات ذكية، سلّم النزول، تقرير أسبوعي)

استمر بتسجيل وزنك كل يوم لمتابعة تقدمك!
  `.trim();

  await ctx.reply(welcome, commandsInlineKeyboard());
  return ctx.reply(
    'يمكنك استخدام الأزرار في الأسفل أو من القائمة هنا لاختيار الأوامر.',
    mainReplyKeyboard()
  );
}

module.exports = { handleStart, commandsInlineKeyboard, mainReplyKeyboard };
