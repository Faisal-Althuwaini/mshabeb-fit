const { ensureUser } = require('../services/weight.js');
const { getReminder, setReminder } = require('./reminder.js');

const DEFAULT_REMINDER_TIME = '08:00'; // 8:00 AM UTC daily

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

سأذكّرك كل يوم الساعة 8:00 صباحاً (UTC) بتسجيل وزنك. لتغيير الموعد: /reminder الساعة:الدقيقة (مثلاً 09:30). للإيقاف: /reminder off

ماذا يمكنك أن تفعل:

/weight 72.5 — سجّل وزنك (بالكيلو). أو أرسل الرقم فقط مثل 72.5
/progress — شاهد تقدمك: وزن اليوم، متوسط الأسبوع، والرسم البياني
/compare week — قارن متوسط هذا الأسبوع بالأسبوع الماضي
/compare day — قارن آخر يومين مسجّلين
/motivate — رسالة تحفيزية عشوائية
/reminder — عرض أو تغيير موعد التذكير اليومي

استمر بتسجيل وزنك كل يوم لمتابعة تقدمك!
  `.trim();

  return ctx.reply(welcome);
}

module.exports = { handleStart };
