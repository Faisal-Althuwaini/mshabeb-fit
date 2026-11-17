// Small building blocks used by every screen. Layout is right-to-left (Arabic).
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApp } from '@/lib/app-data';
import { C, R } from '@/lib/theme';

/** A scrolling page with pull-to-refresh. */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const { refreshing, refresh, error } = useApp();
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.accent} />}
      >
        <T style={styles.title}>{title}</T>
        {error && <T style={styles.error}>{error}</T>}
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

/** Text with the app's defaults (light ink, right-aligned). */
export function T({ children, style, muted }: { children: ReactNode; style?: StyleProp<TextStyle>; muted?: boolean }) {
  return <Text style={[styles.text, muted && { color: C.muted }, style]}>{children}</Text>;
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, direction: 'rtl' },
  content: { padding: 16, gap: 12, paddingBottom: 120 },
  title: { fontSize: 32, fontWeight: '800', marginBottom: 4 },
  error: { color: C.danger },
  card: { backgroundColor: C.card, borderRadius: R.card, padding: 16, gap: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  text: { color: C.ink, fontSize: 16, textAlign: 'right', writingDirection: 'rtl' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
});
