import { View, type DimensionValue } from 'react-native';
import { radius, space } from '../theme/tokens';
import { useTheme } from '../theme/useTheme';
import { Animated, useShimmer } from './motion';

export function Skeleton({
  width = '100%',
  height = 16,
  r = radius.sm,
}: {
  width?: DimensionValue;
  height?: number;
  r?: number;
}) {
  const { colors } = useTheme();
  const a = useShimmer();
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ width, height, borderRadius: r, backgroundColor: colors.surfaceAlt }, a]}
    />
  );
}

/** Placeholder with the same silhouette as a feed card, so the layout doesn't jump when real content arrives. */
export function FeedCardSkeleton() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flex: 1,
        margin: space.lg,
        padding: space.xl,
        gap: space.lg,
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Skeleton width={110} height={28} r={radius.pill} />
      <Skeleton height={34} />
      <Skeleton width="70%" height={34} />
      <View style={{ gap: space.md, marginTop: space.lg }}>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={56} r={radius.md} />
        ))}
      </View>
    </View>
  );
}
