import { StyleSheet, View } from 'react-native';

import { Card, Row, Screen, T } from '@/components/ui';
import { useApp, useSnapshot } from '@/lib/app-data';
import * as S from '@/lib/stats';
import { C } from '@/lib/theme';

const ar = (n: number, d = 1) => S.toArabicDigits(n, d);
const change = (d: number) => (d < 0 ? `نزل ${ar(Math.abs(d))}` : d > 0 ? `زاد ${ar(d)}` : 'ثابت');

/** «التقدم»: weekly averages (the real trend), streaks, and the ladder of milestones. */
export default function Progress() {
  const { settings } = useApp();
  const snap = useSnapshot();
  if (!snap || !settings) return <Screen title="التقدم"><T muted>جاري التحميل…</T></Screen>;

  const weeks = [...snap.weekly].filter((w) => w.avg_weight != null).reverse().slice(0, 10);
  const ladder = snap.ladder;

  return (
    <Screen title="التقدم">
      <Card>
        <T muted>متوسط هالأسبوع</T>
        <T style={styles.big}>{snap.thisWeek.avg_weight != null ? `${ar(snap.thisWeek.avg_weight)} كغ` : '—'}</T>
        {snap.weekChange != null && (
          <T style={{ color: snap.weekChange <= 0 ? C.accent : C.amber, fontWeight: '700' }}>
            {change(snap.weekChange)} عن الأسبوع اللي فات
          </T>
        )}
      </Card>

      <Row style={{ gap: 12 }}>
        <Stat label="🔥 السلسلة" value={`${ar(snap.streak, 0)} يوم`} />
        <Stat label="🏆 أطول سلسلة" value={`${ar(snap.bestStreak, 0)} يوم`} />
      </Row>
      <Row style={{ gap: 12 }}>
        <Stat label="📉 نزلت من البداية" value={snap.totalLost != null ? `${ar(snap.totalLost)} كغ` : '—'} />
        <Stat label="🎯 الهدف" value={settings.goal_weight != null ? `${ar(Number(settings.goal_weight))} كغ` : '—'} />
      </Row>

      {ladder.next != null && (
        <Card>
          <T style={styles.h}>🪜 السلّم</T>
          <T>الدرجة الجاية <T style={styles.bold}>{ar(ladder.next)}</T>{ladder.remaining_to_next != null ? ` · باقي ${ar(ladder.remaining_to_next)} كيلو` : ''}</T>
          <Row style={{ flexWrap: 'wrap', justifyContent: 'flex-start' }}>
            {ladder.steps.map((s: number) => (
              <View key={s} style={[styles.step, ladder.reached.includes(s) && styles.stepOn, s === ladder.next && styles.stepNext]}>
                <T style={[styles.stepText, ladder.reached.includes(s) && { color: C.accentInk }]}>{ar(s, 0)}</T>
              </View>
            ))}
          </Row>
        </Card>
      )}

      <Card>
        <T style={styles.h}>الأسابيع</T>
        {weeks.map((w, i) => {
          const prev = weeks[i + 1];
          const d = prev?.avg_weight != null ? Math.round((w.avg_weight! - prev.avg_weight) * 10) / 10 : null;
          return (
            <Row key={w.week_start} style={styles.weekRow}>
              <T muted>{w.week_start === snap.thisWeek.week_start ? 'هالأسبوع' : S.toArabicDigits(Number(w.week_start.slice(8)), 0) + '/' + S.toArabicDigits(Number(w.week_start.slice(5, 7)), 0)}</T>
              <T style={styles.bold}>{ar(w.avg_weight!)}{d != null ? <T style={{ color: d <= 0 ? C.accent : C.amber, fontWeight: '400' }}>  {d <= 0 ? '↓' : '↑'} {ar(Math.abs(d))}</T> : null}</T>
            </Row>
          );
        })}
      </Card>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <T muted style={{ fontSize: 14 }}>{label}</T>
      <T style={{ fontSize: 22, fontWeight: '800' }}>{value}</T>
    </Card>
  );
}

const styles = StyleSheet.create({
  big: { fontSize: 44, fontWeight: '800' },
  h: { fontSize: 19, fontWeight: '700' },
  bold: { fontWeight: '700' },
  step: { minWidth: 48, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, backgroundColor: C.line, alignItems: 'center' },
  stepOn: { backgroundColor: C.accent },
  stepNext: { borderWidth: 2, borderColor: C.accent },
  stepText: { fontWeight: '700', textAlign: 'center' },
  weekRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
});
