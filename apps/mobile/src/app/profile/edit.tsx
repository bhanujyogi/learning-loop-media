import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useI18n } from '../../i18n/I18nProvider';
import { accountKey } from '../../lib/account';
import { useAuth } from '../../lib/auth';
import {
  BIO_SOFT_MAX,
  NAME_MAX,
  normalizeUsername,
  profileSaveError,
  usernameProblem,
} from '../../lib/profile-model';
import { supabase } from '../../lib/supabase';
import { useNotice } from '../../lib/use-notice';
import { imageProblem, MAX_AVATAR_BYTES, pickImages, uploadAvatar } from '../../lib/upload';
import { space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Avatar } from '../../ui/Avatar';
import { Button, ErrorState, Field, LoadingState, Text } from '../../ui/primitives';
import { ScreenHeader, useGoBack } from '../../ui/ScreenHeader';
import { Toast } from '../../ui/Toast';

/** Edit my public profile: photo, display name, username, bio. The database enforces uniqueness/reserved names. */
export default function EditProfile() {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { session } = useAuth();
  const uid = session?.user.id;
  const qc = useQueryClient();
  const goBack = useGoBack();
  const { notice, show } = useNotice();
  const q = useQuery({
    queryKey: ['my-profile', uid],
    enabled: !!uid,
    queryFn: async () => {
      const r = await supabase
        .from('profiles')
        .select('username, display_name, bio, avatar_path')
        .eq('id', uid!)
        .single();
      if (r.error) throw new Error('load');
      return r.data;
    },
  });
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [userError, setUserError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !ready) {
      setName(q.data.display_name ?? '');
      setUsername(q.data.username ?? '');
      setBio(q.data.bio ?? '');
      setAvatar(q.data.avatar_path ?? null);
      setReady(true);
    }
  }, [q.data, ready]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['my-profile', uid] });
    void qc.invalidateQueries({ queryKey: accountKey(uid) });
    void qc.invalidateQueries({ queryKey: ['public-profile'] });
    void qc.invalidateQueries({ queryKey: ['handle'] });
    void qc.invalidateQueries({ queryKey: ['people'] });
  };

  const changePhoto = async () => {
    if (!uid || photoBusy) return;
    setPhotoError(null);
    try {
      const [file] = await pickImages(false);
      if (!file) return;
      const problem = imageProblem(file, MAX_AVATAR_BYTES);
      if (problem)
        return setPhotoError(t(problem === 'type' ? 'profile.photo.type' : 'profile.photo.size'));
      setPhotoBusy(true);
      setAvatar(await uploadAvatar(file, uid));
      invalidate();
      show(t('profile.photo.done'));
    } catch {
      setPhotoError(t('profile.photo.error'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = async () => {
    if (!uid || saving) return;
    setUserError(null);
    setSaveError(null);
    const handle = normalizeUsername(username);
    const problem = usernameProblem(handle);
    if (problem)
      return setUserError(
        t(problem === 'length' ? 'profile.username.length' : 'profile.username.chars'),
      );
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ username: handle, display_name: name.trim() || null, bio: bio.trim() || null })
      .eq('id', uid);
    setSaving(false);
    const why = profileSaveError(error);
    if (why === 'taken') return setUserError(t('profile.username.taken'));
    if (why === 'unavailable') return setUserError(t('profile.username.unavailable'));
    if (why) return setSaveError(t('profile.saveError'));
    setUsername(handle);
    invalidate();
    show(t('profile.saved.toast'));
  };

  let body: React.ReactNode;
  if (q.isLoading || (q.data && !ready)) body = <LoadingState />;
  else if (q.isError || !q.data)
    body = <ErrorState message={t('profile.loadError')} onRetry={() => void q.refetch()} />;
  else
    body = (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: space.lg, gap: space.lg }}
      >
        <View style={{ alignItems: 'center', gap: space.sm }}>
          <Avatar path={avatar} name={name || username} size={96} />
          <Button
            variant="ghost"
            label={photoBusy ? t('profile.photo.uploading') : t('profile.changePhoto')}
            loading={photoBusy}
            onPress={() => void changePhoto()}
          />
          {photoError ? (
            <Text accessibilityRole="alert" style={{ color: colors.danger }}>
              {photoError}
            </Text>
          ) : null}
        </View>
        <Field
          label={t('profile.field.name')}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          autoCapitalize="words"
          textContentType="name"
        />
        <Field
          label={t('profile.field.username')}
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            setUserError(null);
          }}
          error={userError}
          maxLength={31}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="username"
        />
        <View style={{ gap: space.xs }}>
          <Field
            label={t('profile.field.bio')}
            value={bio}
            onChangeText={setBio}
            maxLength={BIO_SOFT_MAX}
            multiline
            style={{ minHeight: 96, textAlignVertical: 'top' }}
          />
          <Text
            variant="caption"
            muted={bio.length <= BIO_SOFT_MAX}
            style={{
              textAlign: 'right',
              color: bio.length > BIO_SOFT_MAX ? colors.danger : undefined,
            }}
          >
            {bio.length}/{BIO_SOFT_MAX}
          </Text>
        </View>
        {saveError ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {saveError}
          </Text>
        ) : null}
        <Button
          label={saving ? t('profile.saving') : t('profile.save')}
          loading={saving}
          onPress={() => void save()}
        />
        <Button variant="ghost" label={t('common.close')} onPress={goBack} />
      </ScrollView>
    );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={t('profile.edit')} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
        <Toast message={notice} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
