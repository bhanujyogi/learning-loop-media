import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '../../ui/primitives';

export default function Explore() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ padding: 16 }}>
        <Text>…</Text>
      </View>
    </SafeAreaView>
  );
}
