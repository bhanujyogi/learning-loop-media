import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FeedScreen } from '../../features/feed/FeedScreen';
import { useTheme } from '../../theme/useTheme';

export default function FeedTab() {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flex: 1 }}>
        <FeedScreen />
      </View>
    </SafeAreaView>
  );
}
