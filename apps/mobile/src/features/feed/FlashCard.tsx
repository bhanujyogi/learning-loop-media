import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { useI18n } from '../../i18n/I18nProvider';
import { track } from '../../lib/event-queue';
import { useMediaUrl } from '../../lib/media';
import { useReduceMotion } from '../../lib/use-reduce-motion';
import { radius, space } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Animated } from '../../ui/motion';
import { Text } from '../../ui/primitives';

export interface FlashcardBody {
  front?: string;
  back?: string;
  frontMediaId?: string;
  backMediaId?: string;
}

const FLIP_MS = 250;
const FADE_MS = 150;
/** "Tap to flip" is shown until the learner has flipped any card once in this app session. */
let flippedThisSession = false;

/** One side of the card: the picture when there is one (with a graceful fallback to the text), and the text. */
function Face({
  text,
  mediaId,
  accent,
  hint,
  onHeight,
  fill,
  hidden,
}: {
  text: string;
  mediaId?: string;
  accent: boolean;
  hint: boolean;
  onHeight: (h: number) => void;
  fill: boolean;
  hidden: boolean;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const { url, failed } = useMediaUrl(mediaId);
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const showImage = !!mediaId && !!url && !failed && !broken;
  const waiting = !!mediaId && !failed && !broken && !loaded;
  return (
    <View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={hidden}
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          justifyContent: 'center',
          gap: space.md,
          padding: space.lg,
          minHeight: 180,
          borderRadius: radius.lg,
          borderWidth: 2,
          borderColor: accent ? colors.primary : colors.border,
          backgroundColor: colors.surface,
        },
        fill ? { bottom: 0 } : null,
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: url }}
          resizeMode="contain"
          accessible={false}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken(true)}
          style={{ width: '100%', height: 240, borderRadius: radius.md }}
        />
      ) : null}
      {waiting ? (
        <View accessible accessibilityLabel={t('feed.flash.imageLoading')}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : null}
      <Text
        variant={accent ? undefined : 'prompt'}
        style={accent ? { fontSize: 19, lineHeight: 28 } : undefined}
      >
        {text}
      </Text>
      {hint ? (
        <Text variant="caption" muted style={{ textAlign: 'center' }}>
          {t('feed.flash.tapToFlip')}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Flashcard with an optional picture on each side. Tap anywhere to flip (rotateY with perspective, ~250 ms; with reduce-motion
 * a quick crossfade instead). The text of the visible side is the accessibility label, so the card works without the pictures.
 */
export function FlashCard({ contentId, body }: { contentId: string; body: FlashcardBody }) {
  const { t } = useI18n();
  const reduce = useReduceMotion();
  const [flipped, setFlipped] = useState(false);
  const [hint, setHint] = useState(!flippedThisSession);
  const [heights, setHeights] = useState<[number, number]>([0, 0]);
  const flip = useSharedValue(0);
  useEffect(() => {
    flip.value = withTiming(flipped ? 1 : 0, {
      duration: reduce ? FADE_MS : FLIP_MS,
      easing: Easing.inOut(Easing.quad),
    });
  }, [flipped, reduce, flip]);

  const frontStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: interpolate(flip.value, [0, 1], [1, 0]) }
      : {
          transform: [
            { perspective: 1000 },
            { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` },
          ],
        },
  );
  const backStyle = useAnimatedStyle(() =>
    reduce
      ? { opacity: interpolate(flip.value, [0, 1], [0, 1]) }
      : {
          transform: [
            { perspective: 1000 },
            { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` },
          ],
        },
  );

  const front = body.front ?? '';
  const back = body.back ?? '';
  const height = Math.max(heights[0], heights[1], 180);
  const measured = heights[0] > 0 && heights[1] > 0;
  const setH = (i: 0 | 1) => (h: number) =>
    setHeights((p) => (p[i] === h ? p : i === 0 ? [h, p[1]] : [p[0], h]));

  const onPress = () => {
    if (!flipped) track('flashcard_reviewed', { flashcard_id: contentId });
    flippedThisSession = true;
    setHint(false);
    setFlipped((f) => !f);
  };

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${flipped ? t('feed.flash.back') : t('feed.flash.front')}. ${flipped ? back : front}`}
      accessibilityHint={t('feed.flash.a11yHint')}
      style={{ minHeight: 48, height: measured ? height : undefined }}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: measured ? 0 : undefined,
            backfaceVisibility: 'hidden',
          },
          frontStyle,
        ]}
      >
        <Face
          text={front}
          mediaId={body.frontMediaId}
          accent={false}
          hint={hint}
          onHeight={setH(0)}
          fill={measured}
          hidden={flipped}
        />
      </Animated.View>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: measured ? 0 : undefined,
            backfaceVisibility: 'hidden',
          },
          backStyle,
        ]}
      >
        <Face
          text={back}
          mediaId={body.backMediaId}
          accent
          hint={false}
          onHeight={setH(1)}
          fill={measured}
          hidden={!flipped}
        />
      </Animated.View>
    </Pressable>
  );
}
