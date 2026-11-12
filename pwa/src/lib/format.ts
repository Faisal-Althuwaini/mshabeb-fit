import * as S from './stats';

export const ar = (n: number | null | undefined, decimals = 1) => (n == null ? '—' : S.toArabicDigits(n, decimals));
export const arInt = (n: number | null | undefined) => (n == null ? '—' : S.toArabicDigits(n, 0));

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAYS_SHORT = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export const dayName = (d: string) => DAYS[S.dayOfWeek(d)];
export const dayShort = (d: string) => DAYS_SHORT[S.dayOfWeek(d)];
export function dateLabel(d: string, today?: string) {
  if (today && d === today) return 'اليوم';
  if (today && d === S.addDays(today, -1)) return 'أمس';
  const [, m, day] = d.split('-').map(Number);
  return `${dayName(d)} ${arInt(day)} ${MONTHS[m - 1]}`;
}
export const shortDate = (d: string) => {
  const [, m, day] = d.split('-').map(Number);
  return `${arInt(day)}/${arInt(m)}`;
};

export function daysAr(n: number) {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${arInt(n)} أيام`;
  return `${arInt(n)} يوم`;
}

export function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (mins < 1) return 'الحين';
  if (mins < 60) return `قبل ${arInt(mins)} د`;
  const h = Math.round(mins / 60);
  if (h < 24) return `قبل ${arInt(h)} س`;
  return `قبل ${daysAr(Math.round(h / 24))}`;
}
