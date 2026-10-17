import { Image, View } from 'react-native';
import { avatarUrl } from '../lib/media';
import { useTheme } from '../theme/useTheme';
import { Text } from './primitives';

/** Round profile picture; falls back to the person's initial on the brand colour. `ring` adds the Instagram-style gradient-look ring. */
export function Avatar({
  path,
  name,
  size = 40,
  ring,
}: {
  path?: string | null;
  name?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const { colors } = useTheme();
  const uri = avatarUrl(path);
  const inner = ring ? size - 6 : size;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: ring ? 2 : 0,
        borderColor: '#DD2A7B',
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: colors.surfaceAlt,
          }}
        />
      ) : (
        <View
          style={{
            width: inner,
            height: inner,
            borderRadius: inner / 2,
            backgroundColor: colors.primary,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: colors.onPrimary, fontWeight: '700', fontSize: inner * 0.42 }}>
            {(name ?? '?').trim().charAt(0).toUpperCase() || '?'}
          </Text>
        </View>
      )}
    </View>
  );
}
