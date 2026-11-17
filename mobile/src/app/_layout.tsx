import type { Session } from '@supabase/supabase-js';
import { DarkTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';

import AppTabs from '@/components/app-tabs';
import { SignIn } from '@/components/sign-in';
import { AppDataProvider } from '@/lib/app-data';
import { supabase } from '@/lib/supabase';
import { C } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, primary: C.accent } };

/** Signed out → sign-in screen. Signed in → the tabs, with the user's data loaded once for all screens. */
export default function RootLayout() {
  // undefined = still reading the saved login from the phone, null = signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session !== undefined) SplashScreen.hideAsync();
  }, [session]);

  if (session === undefined) return null;

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      {session ? (
        <AppDataProvider key={session.user.id}>
          <AppTabs />
        </AppDataProvider>
      ) : (
        <SignIn />
      )}
    </ThemeProvider>
  );
}
