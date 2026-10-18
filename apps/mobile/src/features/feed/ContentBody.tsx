import { interactiveDefinition } from '@learning-loop/validation';
import { useRouter } from 'expo-router';
import { useI18n } from '../../i18n/I18nProvider';
import { track } from '../../lib/event-queue';
import type { InstantCheck } from '../../lib/instant-check';
import { Button, Text } from '../../ui/primitives';
import { InteractiveRenderer } from '../interactive/InteractiveRenderer';
import {
  ImageCard,
  NotePreview,
  NoteView,
  VideoCard,
  type ImageBody,
  type NoteBody,
} from './MediaCards';
import { FlashCard, type FlashcardBody } from './FlashCard';
import { QuestionCard } from './QuestionCard';
import type { PublicQuestion } from './question-model';

export interface ContentLike {
  contentId: string;
  type: string;
  body: unknown;
  /** single-choice / true-false: instant verdict material from the feed (absent on older cached items and the detail page) */
  instantCheck?: InstantCheck;
}

/**
 * One renderer for every supported content type, used by the feed (`mode="feed"`: compact) and by the full-screen viewer
 * (`mode="full"`). Unsupported types/schemas show a truthful message — nothing is faked.
 */
export function ContentBody({
  item,
  recommendationId,
  mode,
  active = true,
  preload = false,
  onNext,
  onDoubleTap,
}: {
  item: ContentLike;
  recommendationId?: string;
  mode: 'feed' | 'full';
  active?: boolean;
  preload?: boolean;
  onNext?: () => void;
  /** double-tap on a picture (the feed and the viewer use it to like) */
  onDoubleTap?: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const body = item.body as Record<string, unknown>;
  switch (item.type) {
    case 'question':
      return (
        <QuestionCard
          contentId={item.contentId}
          recommendationId={recommendationId}
          body={body as unknown as PublicQuestion}
          active={active}
          onNext={onNext}
          instantCheck={item.instantCheck}
        />
      );
    case 'note':
      return mode === 'full' ? (
        <NoteView body={body as NoteBody} />
      ) : (
        <>
          <NotePreview body={body as NoteBody} />
          <Button
            label={t('feed.openNote')}
            onPress={() => {
              track('content_open', {
                content_id: item.contentId,
                from: 'feed',
                recommendation_id: recommendationId,
              });
              router.push({
                pathname: '/content/[id]',
                params: { id: item.contentId, rec: recommendationId ?? '' },
              });
            }}
          />
        </>
      );
    case 'flashcard':
      return <FlashCard contentId={item.contentId} body={body as FlashcardBody} />;
    case 'video':
      return <VideoCard body={body as never} active={active} preload={preload} />;
    case 'image':
      return (
        <ImageCard
          body={body as ImageBody}
          active={active}
          preload={preload}
          onDoubleTap={onDoubleTap}
        />
      );
    case 'interactive': {
      const parsed = interactiveDefinition.safeParse(body);
      return parsed.success ? (
        <InteractiveRenderer contentId={item.contentId} def={parsed.data} />
      ) : (
        <Text muted>{t('feed.unsupportedInteractive')}</Text>
      );
    }
    default:
      return <Text muted>{t('feed.unsupportedType')}</Text>;
  }
}
