import { View, Text, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

export default function PatientsScreen() {
  const [q, setQ] = useState('');
  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="p-4">
        <Text className="text-2xl font-bold dark:text-white">Bemorlar</Text>
        <TextInput
          className="mt-3 h-11 rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
          placeholder="Qidirish\u2026"
          placeholderTextColor="#9CA3AF"
          value={q}
          onChangeText={setQ}
        />
      </View>
    </SafeAreaView>
  );
}
