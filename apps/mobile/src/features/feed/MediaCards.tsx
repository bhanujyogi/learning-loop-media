import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
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
  if (failed) return <Text muted>This video is unavailable right now.</Text>;
  if (!url) return <Text muted>Loading video…</Text>;
  return (
    <View style={{ gap: space.sm }}>
      <VideoView
        player={player}
        style={{
          width: '100%',
          aspectRatio: 9 / 16,
          maxHeight: 420,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceAlt,
        }}
        contentFit="cover"
        nativeControls={false}
        accessibilityLabel="Video"
      />
      <Button
        variant="secondary"
        label={muted ? 'Unmute' : 'Mute'}
        onPress={() => setMuted((m) => !m)}
      />
    </View>
  );
}

export function NoteCard({
  body,
}: {
  body: {
    blocks?: {
      type: string;
      text?: string;
      level?: number;
      items?: string[];
      latex?: string;
      kind?: string;
      prompt?: string;
      label?: string;
    }[];
  };
}) {
  return (
    <View style={{ gap: space.sm }}>
      {(body.blocks ?? []).slice(0, 12).map((b, i) => {
        switch (b.type) {
          case 'heading':
            return (
              <Text key={i} variant="heading" accessibilityRole="header">
                {b.text}
              </Text>
            );
          case 'paragraph':
            return <Text key={i}>{b.text}</Text>;
          case 'list':
            return (
              <View key={i}>
                {(b.items ?? []).map((it, j) => (
                  <Text key={j}>• {it}</Text>
                ))}
              </View>
            );
          case 'formula':
            return (
              <Card key={i}>
                <Text variant="label" accessibilityLabel={`Formula: ${b.latex}`}>
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
                <Text>{b.text}</Text>
              </Card>
            );
          case 'revision_prompt':
            return (
              <Text key={i} variant="label">
                💭 {b.prompt}
              </Text>
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

export function FlashcardCard({ body }: { body: { front?: string; back?: string } }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <View style={{ gap: space.md }}>
      <Text variant="heading">{body.front}</Text>
      {flipped ? (
        <Card>
          <Text>{body.back}</Text>
        </Card>
      ) : null}
      <Button
        variant="secondary"
        label={flipped ? 'Hide answer' : 'Show answer'}
        onPress={() => setFlipped((f) => !f)}
      />
    </View>
  );
}
