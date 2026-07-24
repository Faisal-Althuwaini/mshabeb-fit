const { getSupabase } = require('../supabase.js');
const { getMotivational } = require('../messages.js');

const TIME_REGEX = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;

function parseTime(str) {
  const s = (str || '').trim();
  const m = s.match(TIME_REGEX);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

async function setReminder(telegramUserId, timeStr, enabled) {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('users')
    .update({
      reminder_enabled: enabled,
      reminder_time: timeStr,
      updated_at: new Date().toISOString(),
    })
    .eq('telegram_user_id', telegramUserId);

  if (error) throw error;
}

async function getReminder(telegramUserId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('reminder_enabled, reminder_time')
    .eq('telegram_user_id', telegramUserId)
    .single();

  if (error || !data) return { enabled: false, time: null };
  return {
    enabled: !!data.reminder_enabled,
    time: data.reminder_time || null,
  };
}

async function handleReminder(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  const text = (ctx.message?.text || '').trim();
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
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
  }

  if (args[0].toLowerCase() === 'off') {
    try {
      await setReminder(from.id, null, false);
      return ctx.reply('تم إيقاف التذكير اليومي.');
    } catch (e) {
      console.error('reminder off error:', e);
      return ctx.reply('حدث خطأ.');
    }
  }

  const timeStr = parseTime(args[0]);
  if (!timeStr) {
    return ctx.reply('استخدم وقتاً مثل 08:00 أو 14:30. للإيقاف: /reminder off');
  }

  try {
    await setReminder(from.id, timeStr, true);
    return ctx.reply(
      `تم ضبط التذكير اليومي على الساعة ${timeStr} (بتوقيت السعودية). سأرسلك تذكيراً لتسجيل وزنك في هذا الموعد.\n\n` +
        getMotivational()
    );
  } catch (e) {
    console.error('reminder set error:', e);
    return ctx.reply('فشل ضبط التذكير. حاول مرة أخرى.');
  }
}

module.exports = { handleReminder, getReminder, setReminder, parseTime };
