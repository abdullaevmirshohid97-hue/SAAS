import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function QueueScreen() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView className="p-4">
        <Text className="text-2xl font-bold dark:text-white">Navbat</Text>
        <Text className="mt-2 text-gray-500">Real-time navbat \u2014 Supabase Realtime</Text>
      </ScrollView>
    </SafeAreaView>
  );
}
