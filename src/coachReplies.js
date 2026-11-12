// Short Saudi-dialect reply builders. Pure: pass in the stats module (S) and a snapshot.

/** ٤ أيام / يومين / يوم واحد / ١٢ يوم */
function daysAr(S, n) {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${S.toArabicDigits(n)} أيام`;
  return `${S.toArabicDigits(n)} يوم`;
}

function streakLine(S, snap) {
  if (!snap.streak) return 'سلسلتك تبدأ اليوم 💪';
  return `سلسلتك: ${daysAr(S, snap.streak)} 🔥`;
}

/** Reply after a weigh-in is saved. */
function weightSaved(S, snap, weight) {
  const lines = [`تم ✅ ${S.toArabicDigits(weight)}`];
  const tw = snap.thisWeek.avg_weight;
  const lw = snap.lastWeek.avg_weight;
  if (tw != null) {
    lines.push(
      `متوسط الأسبوع لين الحين: ${S.toArabicDigits(tw)}` +
        (lw != null ? ` (الأسبوع اللي فات ${S.toArabicDigits(lw)})` : '')
    );
  }
  lines.push(streakLine(S, snap));
  return lines.join('\n');
}

function minimumDone(S, snap, minimumAction) {
  return `تم ✅ سويت يومك الأدنى (${minimumAction}).\nاليوم الأدنى يكفي 👌\n${streakLine(S, snap)}`;
}

function lifted(S, snap, required, label) {
  const n = snap.thisWeek.lifting_days;
  const labelAr = label === 'anterior' ? ' (أمامي)' : label === 'posterior' ? ' (خلفي)' : '';
  let line = `تم 🏋️ حديد${labelAr}\nحديد هالأسبوع: ${S.toArabicDigits(n)}/${S.toArabicDigits(required)}`;
  if (n >= required) line += ' ✅';
  return line;
}

const WEEK_DAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function dateAr(S, dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${WEEK_DAYS_AR[S.dayOfWeek(dateStr)]} ${S.toArabicDigits(d)}/${S.toArabicDigits(m)}`;
}

/**
 * Template weekly report (fallback until the M4 DeepSeek report).
 * @param week   a weeklyStats row
 * @param prev   the previous week's row (may be empty)
 */
function weeklyReport(S, { week, prev, snap, settings, trendMessage }) {
  const req = settings.lifting_days_required ?? 2;
  const end = S.addDays(week.week_start, 6);
  const lines = [`📊 ملخص الأسبوع (${dateAr(S, week.week_start)} – ${dateAr(S, end)})`, ''];

  if (week.avg_weight != null) {
    let l = `المتوسط: ${S.toArabicDigits(week.avg_weight)} (${S.toArabicDigits(week.n_weighins)} وزنات)`;
    if (prev && prev.avg_weight != null) {
      l += `\nالأسبوع اللي فات: ${S.toArabicDigits(prev.avg_weight)} ← ${S.formatDelta(week.avg_weight - prev.avg_weight)}`;
    }
    lines.push(l);
    if (!week.is_complete) lines.push('(أقل من ٣ وزنات، فالمتوسط تقريبي)');
  } else {
    lines.push('ما فيه وزنات هالأسبوع. عادي، الأسبوع الجاي نبدأ من جديد.');
  }

  lines.push(`الحديد: ${S.toArabicDigits(week.lifting_days)}/${S.toArabicDigits(req)}${week.lifting_days >= req ? ' ✅' : ''}`);
  lines.push(`اليوم الأدنى: ${S.toArabicDigits(week.minimum_days)}/٧`);
  lines.push(streakLine(S, snap));
  if (snap.ladder.next != null && snap.ladder.remaining_to_next != null && snap.ladder.remaining_to_next > 0) {
    lines.push(`الدرجة الجاية: ${S.toArabicDigits(snap.ladder.next)} (باقي ${S.toArabicDigits(snap.ladder.remaining_to_next)} كيلو)`);
  }
  if (trendMessage) lines.push('', trendMessage);
  return lines.join('\n');
}

module.exports = { daysAr, streakLine, weightSaved, minimumDone, lifted, weeklyReport, dateAr };
