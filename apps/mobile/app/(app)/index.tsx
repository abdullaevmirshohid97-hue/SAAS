import { View, Text, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function Dashboard() {
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <ScrollView className="p-4">
        <Text className="text-2xl font-bold dark:text-white">Boshqaruv paneli</Text>
        <View className="mt-4 grid gap-3">
          {['Navbatda: 8', 'Bugungi qabullar: 24', 'Faol xodimlar: 6'].map((m) => (
            <View key={m} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Text className="dark:text-white">{m}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
