import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { track } from '../../lib/event-queue';
import { supabase } from '../../lib/supabase';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { Button, Card, Text } from '../../ui/primitives';

/** Resolves a media_assets id to a short-lived signed URL (private bucket; RLS decides what the user may read). */
function useMediaUrl(mediaId: string | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!mediaId) return;
    let live = true;
    (async () => {
      const { data: m } = await supabase
        .from('media_assets')
        .select('bucket, storage_key')
        .eq('id', mediaId)
        .maybeSingle();
      if (!m) {
        if (live) setFailed(true);
        return;
      }
      const { data, error } = await supabase.storage
        .from(m.bucket)
        .createSignedUrl(m.storage_key, 3600);
      if (live) {
        if (error || !data) setFailed(true);
        else setUrl(data.signedUrl);
      }
    })().catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [mediaId]);
  return { url, failed };
}

/** Plays only while `active`; neighbours may preload; distant cards release the player entirely (parent unmounts this component). */
export function VideoCard({
  body,
  active,
  preload,
}: {
  body: { mediaId?: string; durationMs?: number };
  active: boolean;
  preload: boolean;
}) {
  const { t } = useI18n();
  const { url, failed } = useMediaUrl(preload || active ? body.mediaId : undefined);
  const [muted, setMuted] = useState(true);
  const player = useVideoPlayer(url, (p) => {
    p.loop = true;
    p.muted = true;
  });
  useEffect(() => {
    if (active) player.play();
    else player.pause();
  }, [active, player]);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  const { colors } = useTheme();
  if (failed) return <Text muted>{t('video.unavailable')}</Text>;
  if (!url) return <Text muted>{t('video.loading')}</Text>;
  return (
    <View style={{ gap: space.sm }}>
      <VideoView
        player={player}
        style={{
          width: '100%',
          aspectRatio: 9 / 16,
          maxHeight: 420,
          borderRadius: radius.lg,
          backgroundColor: colors.surfaceAlt,
        }}
        contentFit="cover"
        nativeControls={false}
        accessibilityLabel={t('video.a11y')}
      />
      <Button
        variant="secondary"
        label={muted ? t('video.unmute') : t('video.mute')}
        onPress={() => setMuted((m) => !m)}
      />
    </View>
  );
}

interface NoteBlock {
  type: string;
  text?: string;
  level?: number;
  items?: string[];
  latex?: string;
  kind?: string;
  prompt?: string;
  label?: string;
}
export interface NoteBody {
  blocks?: NoteBlock[];
}

/** Compact feed version of a note: first heading + first paragraph, so a long note never overflows a card. */
export function NotePreview({ body }: { body: NoteBody }) {
  const blocks = body.blocks ?? [];
  const lead = blocks.find((b) => b.type === 'paragraph' || b.type === 'callout');
  const formula = blocks.find((b) => b.type === 'formula');
  return (
    <View style={{ gap: space.md }}>
      {lead?.text ? (
        <Text numberOfLines={5} style={{ fontSize: 18, lineHeight: 27 }}>
          {lead.text}
        </Text>
      ) : null}
      {formula?.latex ? (
        <Card>
          <Text variant="heading" style={{ textAlign: 'center' }}>
            {formula.latex}
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

/** Whole note (opened full-screen): every block type the content schema allows. */
export function NoteView({ body }: { body: NoteBody }) {
  const { t } = useI18n();
  return (
    <View style={{ gap: space.md }}>
      {(body.blocks ?? []).map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <Text
                key={i}
                variant={b.level && b.level > 1 ? 'heading' : 'display'}
                accessibilityRole="header"
              >
                {b.text}
              </Text>
            );
          case 'paragraph':
            return (
              <Text key={i} style={{ fontSize: 18, lineHeight: 28 }}>
                {b.text}
              </Text>
            );
          case 'list':
            return (
              <View key={i} style={{ gap: space.xs }}>
                {(b.items ?? []).map((it, j) => (
                  <Text key={j} style={{ fontSize: 18, lineHeight: 28 }}>
                    • {it}
                  </Text>
                ))}
              </View>
            );
          case 'formula':
            return (
              <Card key={i}>
                <Text
                  variant="heading"
                  style={{ textAlign: 'center' }}
                  accessibilityLabel={t('note.formula', { latex: b.latex ?? '' })}
                >
                  {b.latex}
                </Text>
              </Card>
            );
          case 'callout':
            return (
              <Card key={i}>
                <Text variant="caption" muted>
                  {(b.kind ?? 'note').toUpperCase()}
                </Text>
                <Text style={{ fontSize: 17, lineHeight: 26 }}>{b.text}</Text>
              </Card>
            );
          case 'revision_prompt':
            return (
              <Card key={i}>
                <Text variant="caption" muted>
                  {t('note.revision')}
                </Text>
                <Text variant="label">💭 {b.prompt}</Text>
              </Card>
            );
          case 'concept_link':
            return (
              <Text key={i} variant="label">
                → {b.label}
              </Text>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}

export function FlashcardCard({
  contentId,
  body,
}: {
  contentId: string;
  body: { front?: string; back?: string };
}) {
  const { t } = useI18n();
  const [flipped, setFlipped] = useState(false);
  return (
    <View style={{ gap: space.lg }}>
      <Text variant="prompt">{body.front}</Text>
      {flipped ? (
        <Card style={{ borderWidth: 2 }}>
          <Text style={{ fontSize: 19, lineHeight: 28 }}>{body.back}</Text>
        </Card>
      ) : null}
      <Button
        variant={flipped ? 'secondary' : 'primary'}
        label={flipped ? t('flash.hide') : t('flash.show')}
        onPress={() => {
          if (!flipped) track('flashcard_reviewed', { flashcard_id: contentId });
          setFlipped((f) => !f);
        }}
      />
    </View>
  );
}
