import { View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function CashierScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="p-4">
        <Text className="text-2xl font-bold dark:text-white">Kassa</Text>
        <Text className="mt-2 text-gray-500">Quick-pay, Click/Payme QR codes (Phase 5 full)</Text>
      </View>
    </SafeAreaView>
  );
}
