import { useState } from 'react';
import { KeyboardAvoidingView, Platform, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Button, Text } from '../ui/primitives';

export default function SignIn() {
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    color: colors.text,
    backgroundColor: colors.surface,
  } as const;

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    const { error } =
      mode === 'in'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    setBusy(false);
    // Generic messages: don't reveal whether an account exists.
    if (error)
      setMsg(
        mode === 'in'
          ? 'Sign-in failed. Check your email and password.'
          : 'Could not create the account. Try a different email or a stronger password (8+ characters).',
      );
    else if (mode === 'up')
      setMsg('Check your email to confirm your account if confirmation is required.');
  };
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1, justifyContent: 'center', padding: space.xl, gap: space.lg }}
      >
        <Text variant="title" accessibilityRole="header">
          Learning Loop
        </Text>
        <Text muted>Learn a little, every time you scroll.</Text>
        <View style={{ gap: space.md }}>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={colors.textMuted}
            style={input}
          />
          <TextInput
            accessibilityLabel="Password"
            secureTextEntry
            autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            placeholderTextColor={colors.textMuted}
            style={input}
          />
        </View>
        {msg ? (
          <Text accessibilityRole="alert" muted>
            {msg}
          </Text>
        ) : null}
        <Button
          label={mode === 'in' ? 'Sign in' : 'Create account'}
          onPress={submit}
          loading={busy}
          disabled={!email || password.length < 8}
        />
        <Button
          variant="ghost"
          label={mode === 'in' ? 'New here? Create an account' : 'Have an account? Sign in'}
          onPress={() => setMode(mode === 'in' ? 'up' : 'in')}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
