import { Alert, Pressable, StyleSheet } from 'react-native';

import { Card, Row, Screen, T } from '@/components/ui';
import { useApp } from '@/lib/app-data';
import * as S from '@/lib/stats';
import { supabase } from '@/lib/supabase';
import { C, R } from '@/lib/theme';

export default function SettingsScreen() {
  const { who, settings } = useApp();
  const ar = (n: number | null | undefined) => (n == null ? '—' : S.toArabicDigits(Number(n), 1));

  const signOut = () =>
    Alert.alert('تسجيل خروج', 'متأكد؟', [
      { text: 'إلغاء', style: 'cancel' },
      { text: 'خروج', style: 'destructive', onPress: () => supabase.auth.signOut() },
    ]);

  return (
    <Screen title="الإعدادات">
      <Card>
        <Row><T muted>الاسم</T><T style={styles.v}>{settings?.display_name || who?.first_name || '—'}</T></Row>
        <Row><T muted>وزن البداية</T><T style={styles.v}>{ar(settings?.start_weight)} كغ</T></Row>
        <Row><T muted>الهدف</T><T style={styles.v}>{ar(settings?.goal_weight)} كغ</T></Row>
        <Row><T muted>أقل شي</T><T style={styles.v}>{settings?.minimum_action ?? '—'}</T></Row>
        <T muted style={{ fontSize: 13 }}>تعديل الإعدادات من الموقع للحين.</T>
      </Card>
      <Pressable style={({ pressed }) => [styles.out, pressed && { opacity: 0.8 }]} onPress={signOut}>
        <T style={styles.outText}>تسجيل خروج</T>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  v: { fontWeight: '700' },
  out: { borderRadius: R.button, paddingVertical: 15, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  outText: { color: C.danger, fontWeight: '700', textAlign: 'center' },
});
