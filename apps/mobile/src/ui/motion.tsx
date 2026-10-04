import { useEffect } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  interpolate,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useReduceMotion } from '../lib/use-reduce-motion';

/** Entrance animation that honours the OS "reduce motion" setting (renders instantly when it's on). */
export const enter = (delay = 0) =>
  FadeInDown.duration(260).delay(delay).reduceMotion(ReduceMotion.System);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Pressable with a subtle spring scale on touch: clear feedback without delaying the action. */
export function PressableScale({
  style,
  disabled,
  onPressIn,
  onPressOut,
  ...p
}: PressableProps & { style?: StyleProp<ViewStyle> }) {
  const reduce = useReduceMotion();
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  return (
    <AnimatedPressable
      {...p}
      disabled={disabled}
      onPressIn={(e) => {
        if (!reduce && !disabled) s.value = withSpring(0.97, { duration: 120 });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.value = withSpring(1, { duration: 180 });
        onPressOut?.(e);
      }}
      style={[style, a]}
    />
  );
}

/** One-shot "pop" used when a result appears (correct answer, XP). Static under reduce-motion. */
export function usePop(trigger: unknown) {
  const reduce = useReduceMotion();
  const s = useSharedValue(1);
  useEffect(() => {
    if (trigger == null || reduce) return;
    s.value = withSequence(
      withTiming(0.92, { duration: 0 }),
      withSpring(1, { damping: 8, stiffness: 180 }),
    );
  }, [trigger, reduce, s]);
  return useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
}

/** Looping 0→1 shimmer phase for skeletons (stopped when reduce-motion is on). */
export function useShimmer() {
  const reduce = useReduceMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => cancelAnimation(t);
  }, [reduce, t]);
  return useAnimatedStyle(() => ({
    opacity: reduce ? 0.6 : interpolate(t.value, [0, 1], [0.45, 0.9]),
  }));
}

export { Animated };
