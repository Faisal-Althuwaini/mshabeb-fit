import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { supabase } from '@/lib/supabase';
import { C, R } from '@/lib/theme';

/** Email + password, the same accounts as the website. */
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signIn = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(/invalid login/i.test(error.message) ? 'الإيميل أو كلمة المرور غلط' : error.message);
    setBusy(false);
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <Image source={require('@/assets/images/mushabbab.jpg')} style={styles.hero} />
      <Text style={styles.title}>مشبب</Text>
      <Text style={styles.sub}>متوسط الأسبوع، مو رقم الصبح</Text>
      <TextInput
        style={styles.input} placeholder="الإيميل" placeholderTextColor={C.faint}
        value={email} onChangeText={setEmail}
        autoCapitalize="none" keyboardType="email-address" autoComplete="email" textContentType="emailAddress"
      />
      <TextInput
        style={styles.input} placeholder="كلمة المرور" placeholderTextColor={C.faint}
        value={password} onChangeText={setPassword}
        secureTextEntry autoComplete="password" textContentType="password" onSubmitEditing={signIn}
      />
      {error && <Text style={styles.error}>{error}</Text>}
      <Pressable style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]} onPress={signIn} disabled={busy}>
        {busy ? <ActivityIndicator color={C.accentInk} /> : <Text style={styles.buttonText}>دخول</Text>}
      </Pressable>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: C.bg },
  hero: { width: 112, height: 112, borderRadius: 28, borderWidth: 3, borderColor: C.accent, alignSelf: 'center', marginBottom: 4 },
  title: { fontSize: 36, fontWeight: '800', color: C.ink, textAlign: 'center' },
  sub: { fontSize: 15, color: C.muted, textAlign: 'center', marginBottom: 12 },
  input: { fontSize: 17, color: C.ink, borderWidth: 1, borderColor: C.line, borderRadius: R.button, padding: 16, textAlign: 'right' },
  error: { color: C.danger, textAlign: 'center' },
  button: { backgroundColor: C.accent, borderRadius: R.button, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
  buttonText: { fontSize: 18, fontWeight: '700', color: C.accentInk },
});
