import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useAuth } from '../src/providers/auth-provider';
import { usePatientAuth } from '../src/providers/patient-auth-provider';

export default function Entry() {
  const router = useRouter();
  const { session, role, loading: staffLoading } = useAuth();
  const { user, loading: patientLoading } = usePatientAuth();

  if (staffLoading || patientLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white dark:bg-black">
        <ActivityIndicator color="#2563EB" />
      </View>
    );
  }

  // Mavjud sessiya bo'lsa — to'g'ridan-to'g'ri ichkariga (hamshira → o'z oqimi).
  if (session) return <Redirect href={role === 'nurse' ? '/(nurse)/' : '/(app)/'} />;
  if (user) return <Redirect href="/(patient)/" />;

  return (
    <View className="flex-1 justify-center bg-white px-6 dark:bg-black">
      <Text className="text-4xl font-bold text-blue-600">Clary</Text>
      <Text className="mt-2 text-base text-gray-500 dark:text-gray-400">
        Sog'liqni saqlash — bir ilovada
      </Text>

      <View className="mt-12 gap-4">
        <TouchableOpacity
          className="flex-row items-center gap-4 rounded-2xl bg-blue-600 p-5"
          onPress={() => router.push('/(patient-auth)/login')}
        >
          <Feather name="user" color="white" size={26} />
          <View className="flex-1">
            <Text className="text-lg font-semibold text-white">Men bemorman</Text>
            <Text className="text-sm text-blue-100">Klinika topish, navbat olish, hamshira chaqirish</Text>
          </View>
          <Feather name="chevron-right" color="white" size={22} />
        </TouchableOpacity>

        <TouchableOpacity
          className="flex-row items-center gap-4 rounded-2xl border border-gray-200 p-5 dark:border-gray-700"
          onPress={() => router.push('/(auth)/login')}
        >
          <Feather name="briefcase" color="#2563EB" size={26} />
          <View className="flex-1">
            <Text className="text-lg font-semibold dark:text-white">Men xodimman</Text>
            <Text className="text-sm text-gray-500 dark:text-gray-400">Klinika boshqaruvi (login + parol)</Text>
          </View>
          <Feather name="chevron-right" color="#9CA3AF" size={22} />
        </TouchableOpacity>
      </View>
    </View>
  );
}
