import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../i18n/I18nProvider';
import {
  authErrorKey,
  normalizeEmail,
  validateEmail,
  validatePassword,
} from '../lib/auth-validation';
import { supabase } from '../lib/supabase';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { LanguageSwitch } from '../ui/LanguageSwitch';
import { enter, Animated } from '../ui/motion';
import { Button, Field, Text } from '../ui/primitives';

export default function SignIn() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const submitting = useRef(false);
  const pwRef = useRef<TextInput>(null);

  const emailErr = touched.email ? validateEmail(email) : null;
  const pwErr = touched.password ? validatePassword(password, mode) : null;

  const submit = async () => {
    if (submitting.current) return; // no double submit on fast taps / keyboard "go"
    setTouched({ email: true, password: true });
    setFormError(null);
    if (validateEmail(email) || validatePassword(password, mode)) return;
    submitting.current = true;
    setBusy(true);
    try {
      const creds = { email: normalizeEmail(email), password };
      if (mode === 'in') {
        const { error } = await supabase.auth.signInWithPassword(creds);
        if (error) setFormError(t(authErrorKey(error, 'in')));
        // success: AuthProvider sees the session and the routing gate takes over
      } else {
        const { data, error } = await supabase.auth.signUp(creds);
        if (error) setFormError(t(authErrorKey(error, 'up')));
        else if (!data.session) setConfirmEmail(creds.email); // email confirmation is required by the project
      }
    } catch (e) {
      setFormError(t(authErrorKey(e, mode))); // thrown network errors
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'in' ? 'up' : 'in');
    setFormError(null);
    setTouched({ email: false, password: false });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: space.xl,
            gap: space.xl,
          }}
        >
          <LanguageSwitch />
          <Animated.View entering={enter()} style={{ gap: space.sm }}>
            <View
              accessibilityElementsHidden
              style={{
                width: 64,
                height: 64,
                borderRadius: radius.lg,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontSize: 34 }}>🔁</Text>
            </View>
            <Text variant="display" accessibilityRole="header">
              Learning Loop
            </Text>
            <Text muted>{t('auth.tagline')}</Text>
          </Animated.View>

          {confirmEmail ? (
            <Animated.View
              entering={enter()}
              style={{ gap: space.lg }}
              accessibilityLiveRegion="polite"
            >
              <Text variant="heading" accessibilityRole="header">
                {t('auth.checkEmail.title')}
              </Text>
              <Text>{t('auth.checkEmail.body', { email: confirmEmail })}</Text>
              <Button
                variant="secondary"
                label={t('auth.checkEmail.back')}
                onPress={() => {
                  setConfirmEmail(null);
                  setMode('in');
                }}
              />
            </Animated.View>
          ) : (
            <Animated.View entering={enter(80)} style={{ gap: space.lg }}>
              <Field
                label={t('auth.email')}
                value={email}
                onChangeText={setEmail}
                onBlur={() => setTouched((s) => ({ ...s, email: true }))}
                error={emailErr ? t(emailErr) : null}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                keyboardType="email-address"
                returnKeyType="next"
                onSubmitEditing={() => pwRef.current?.focus()}
                editable={!busy}
              />
              <Field
                ref={pwRef}
                label={t('auth.password')}
                value={password}
                onChangeText={setPassword}
                onBlur={() => setTouched((s) => ({ ...s, password: true }))}
                error={pwErr ? t(pwErr) : null}
                secureTextEntry={!show}
                autoCapitalize="none"
                autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
                placeholder={mode === 'up' ? t('auth.passwordHint') : undefined}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
                editable={!busy}
                trailing={
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={show ? t('auth.hide') : t('auth.show')}
                    onPress={() => setShow((s) => !s)}
                    hitSlop={8}
                    style={{
                      minHeight: 48,
                      minWidth: 48,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text variant="label" style={{ color: colors.primary }}>
                      {show ? t('auth.hide') : t('auth.show')}
                    </Text>
                  </Pressable>
                }
              />
              {formError ? (
                <View
                  accessibilityRole="alert"
                  accessibilityLiveRegion="assertive"
                  style={{
                    padding: space.md,
                    borderRadius: radius.md,
                    backgroundColor: colors.dangerBg,
                    borderWidth: 1,
                    borderColor: colors.danger,
                  }}
                >
                  <Text style={{ color: colors.danger, fontWeight: '600' }}>{formError}</Text>
                </View>
              ) : null}
              <Button
                label={mode === 'in' ? t('auth.signIn') : t('auth.signUp')}
                onPress={() => void submit()}
                loading={busy}
              />
              <Button
                variant="ghost"
                label={mode === 'in' ? t('auth.toSignUp') : t('auth.toSignIn')}
                onPress={switchMode}
                disabled={busy}
              />
            </Animated.View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
