import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Card, Row, Screen, T } from '@/components/ui';
import { useApp, useSnapshot } from '@/lib/app-data';
import * as S from '@/lib/stats';
import { C, R } from '@/lib/theme';

const ar = (n: number, d = 1) => S.toArabicDigits(n, d);
const DAYS = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];

/** «اليوم»: log today's weight, tick «أقل شي» / «حديد», see steps, sleep and the week. */
export default function Today() {
  const { who, settings, bundle, today, logWeight, toggleCheck } = useApp();
  const snap = useSnapshot();
  const [input, setInput] = useState('');

  if (!who) return <Screen title="اليوم"><T muted>جاري التحميل…</T></Screen>;
  if (!who.telegram_user_id || !who.coach_enabled) {
    return (
      <Screen title="اليوم">
        <Card><T>ابدأ من موقع مشبب أول (وزنك وهدفك)، وبعدها ارجع هنا واسحب الصفحة لتحت.</T></Card>
      </Screen>
    );
  }
  if (!settings || !bundle || !snap) return <Screen title="اليوم"><T muted>جاري التحميل…</T></Screen>;

  const check = bundle.checks.find((c) => c.day === today);
  const todayWeight = snap.todayWeight;

  const save = async () => {
    const parsed = S.parseWeightInput(input);
    if (!parsed.ok) return;
    const w = parsed.value;
    Keyboard.dismiss();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setInput('');
    await logWeight(w);
  };

  const toggle = (key: 'minimum_done' | 'lifted') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    toggleCheck(key, !check?.[key]);
  };

  const goal = settings.steps_goal ?? 6000;
  const steps = check?.steps ?? null;
  const week = Array.from({ length: 7 }, (_, i) => S.addDays(snap.thisWeek.week_start, i));

  return (
    <Screen title="اليوم">
      <Card>
        <Row>
          <T style={styles.h}>وزن اليوم</T>
          {snap.streak > 0 && <View style={styles.chip}><T style={styles.chipText}>🔥 {ar(snap.streak, 0)} يوم</T></View>}
        </Row>
        <TextInput
          style={styles.weight}
          value={input}
          onChangeText={setInput}
          placeholder={todayWeight != null ? ar(todayWeight) : 'مثلاً ١١٠٫٥'}
          placeholderTextColor={C.faint}
          keyboardType="decimal-pad"
          returnKeyType="done"
          onSubmitEditing={save}
        />
        <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]} onPress={save}>
          <T style={styles.buttonText}>{todayWeight != null ? 'تحديث' : 'حفظ'}</T>
        </Pressable>
        {snap.thisWeek.avg_weight != null && (
          <T muted>
            متوسط الأسبوع لين الحين: <T style={styles.bold}>{ar(snap.thisWeek.avg_weight)}</T>
            {snap.lastWeek.avg_weight != null ? ` (الأسبوع اللي فات ${ar(snap.lastWeek.avg_weight)})` : ''}
          </T>
        )}
      </Card>

      <CheckRow title="سويت أقل شي" sub={settings.minimum_action} on={!!check?.minimum_done} onPress={() => toggle('minimum_done')} />
      <CheckRow title="تمرنت حديد" sub={`الأساس ${ar(settings.lifting_days_required, 0)} أيام بالأسبوع`} on={!!check?.lifted} onPress={() => toggle('lifted')} />

      {(steps != null || check?.sleep_minutes != null) && (
        <Card>
          <Row>
            <T style={styles.bold}>👣 {(steps ?? 0).toLocaleString('ar-SA')} <T muted>/ {goal.toLocaleString('ar-SA')} خطوة</T></T>
            {(steps ?? 0) >= goal && <T style={{ color: C.accent }}>✅</T>}
          </Row>
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${Math.min(100, ((steps ?? 0) / goal) * 100)}%` }]} />
          </View>
          {check?.sleep_minutes != null && (
            <T style={styles.bold}>
              😴 {ar(Math.floor(check.sleep_minutes / 60), 0)} س {ar(check.sleep_minutes % 60, 0)} د <T muted>نوم البارحة</T>
            </T>
          )}
        </Card>
      )}

      <Card>
        <Row>
          <T style={styles.h}>هالأسبوع</T>
          <T muted>🏋️ {ar(snap.thisWeek.lifting_days, 0)}/{ar(settings.lifting_days_required, 0)}</T>
        </Row>
        <Row style={{ marginTop: 4 }}>
          {week.map((d) => {
            const c = bundle.checks.find((x) => x.day === d);
            const w = bundle.entries.some((e) => e.date === d);
            return (
              <View key={d} style={styles.day}>
                <T style={[styles.dayLabel, d === today && { color: C.accent }]}>{DAYS[S.dayOfWeek(d)]}</T>
                <View style={[styles.dot, w && { backgroundColor: C.ink }]} />
                <View style={[styles.dot, c?.minimum_done && { backgroundColor: C.accent }]} />
                <View style={[styles.dot, c?.lifted && { backgroundColor: C.blue }]} />
              </View>
            );
          })}
        </Row>
        <Row style={{ justifyContent: 'center', gap: 16 }}>
          <T muted style={styles.legend}>⚪ وزن</T>
          <T muted style={styles.legend}>🟢 أقل شي</T>
          <T muted style={styles.legend}>🔵 حديد</T>
        </Row>
      </Card>
    </Screen>
  );
}

function CheckRow({ title, sub, on, onPress }: { title: string; sub: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.checkRow, on && styles.checkOn, pressed && { opacity: 0.85 }]}>
      <View style={[styles.circle, on && styles.circleOn]}>{on && <T style={styles.tick}>✓</T>}</View>
      <View style={{ flex: 1 }}>
        <T style={styles.h}>{title}</T>
        <T muted>{sub}</T>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h: { fontSize: 19, fontWeight: '700' },
  bold: { fontWeight: '700' },
  chip: { backgroundColor: C.accentSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: C.accent, fontWeight: '700', fontSize: 14 },
  weight: { fontSize: 48, fontWeight: '800', color: C.ink, textAlign: 'center', borderWidth: 1, borderColor: C.line, borderRadius: R.button, paddingVertical: 14 },
  button: { backgroundColor: C.accent, borderRadius: R.button, paddingVertical: 15, alignItems: 'center' },
  buttonText: { color: C.accentInk, fontWeight: '800', fontSize: 18, textAlign: 'center' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.card, borderRadius: R.card, padding: 16, borderWidth: 1, borderColor: C.line },
  checkOn: { borderColor: C.accent, backgroundColor: C.accentSoft },
  circle: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  circleOn: { backgroundColor: C.accent, borderColor: C.accent },
  tick: { color: C.accentInk, fontWeight: '900', fontSize: 18, textAlign: 'center' },
  meter: { height: 10, borderRadius: 5, backgroundColor: C.line, overflow: 'hidden' },
  meterFill: { height: '100%', backgroundColor: C.accent, borderRadius: 5 },
  day: { alignItems: 'center', gap: 6, flex: 1 },
  dayLabel: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.line },
  legend: { fontSize: 13 },
});
