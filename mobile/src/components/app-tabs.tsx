import { NativeTabs } from 'expo-router/native-tabs';

import { C } from '@/lib/theme';

/** The iOS/Android native tab bar. Each Trigger name is a file in src/app/. */
export default function AppTabs() {
  return (
    <NativeTabs backgroundColor={C.bg} tintColor={C.accent} labelStyle={{ selected: { color: C.accent } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>اليوم</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="sun.max.fill" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Label>التقدم</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="chart.line.downtrend.xyaxis" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>الإعدادات</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="gearshape.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
