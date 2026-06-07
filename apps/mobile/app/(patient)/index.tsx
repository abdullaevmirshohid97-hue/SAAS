import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { usePatientAuth } from '../../src/providers/patient-auth-provider';

function QuickAction({ icon, label, onPress }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      className="flex-1 items-center gap-2 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900"
      onPress={onPress}
    >
      <Feather name={icon} size={26} color="#2563EB" />
      <Text className="text-center text-sm font-medium dark:text-gray-200">{label}</Text>
    </TouchableOpacity>
  );
}

export default function PatientHome() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = usePatientAuth();

  return (
    <ScrollView className="flex-1 bg-white dark:bg-black" contentContainerStyle={{ paddingTop: insets.top + 16, padding: 16 }}>
      <Text className="text-2xl font-bold dark:text-white">
        Assalomu alaykum 👋
      </Text>
      <Text className="mt-1 text-gray-500 dark:text-gray-400">{user?.full_name ?? user?.phone}</Text>

      <View className="mt-6 flex-row gap-3">
        <QuickAction icon="map-pin" label="Klinika topish" onPress={() => router.push('/(patient)/clinics')} />
        <QuickAction icon="calendar" label="Navbatlarim" onPress={() => router.push('/(patient)/bookings')} />
      </View>
      <View className="mt-3 flex-row gap-3">
        <QuickAction icon="plus-circle" label="Hamshira chaqirish" onPress={() => router.push('/(patient)/nurse')} />
        <QuickAction icon="user" label="Profil" onPress={() => router.push('/(patient)/profile')} />
      </View>

      <View className="mt-8 rounded-2xl bg-blue-600 p-5">
        <Text className="text-lg font-semibold text-white">Klinika qidiring</Text>
        <Text className="mt-1 text-sm text-blue-100">
          Eng yaqin va yuqori reytingli klinikalarni toping, onlayn navbat oling.
        </Text>
        <TouchableOpacity
          className="mt-4 self-start rounded-lg bg-white px-4 py-2"
          onPress={() => router.push('/(patient)/clinics')}
        >
          <Text className="font-semibold text-blue-600">Boshlash</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
