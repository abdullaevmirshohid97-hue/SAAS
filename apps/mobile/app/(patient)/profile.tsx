import { View, Text, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { usePatientAuth } from '../../src/providers/patient-auth-provider';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut } = usePatientAuth();

  function confirmSignOut() {
    Alert.alert('Chiqish', 'Akkauntdan chiqmoqchimisiz?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'Chiqish',
        style: 'destructive',
        onPress: async () => {
          await signOut();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top + 16, paddingHorizontal: 16 }}>
      <Text className="text-2xl font-bold dark:text-white">Profil</Text>

      <View className="mt-6 items-center">
        <View className="h-20 w-20 items-center justify-center rounded-full bg-blue-100">
          <Feather name="user" size={36} color="#2563EB" />
        </View>
        <Text className="mt-3 text-lg font-semibold dark:text-white">{user?.full_name ?? '—'}</Text>
        <Text className="text-gray-500 dark:text-gray-400">{user?.phone}</Text>
        {user?.is_verified && (
          <View className="mt-2 flex-row items-center gap-1 rounded-full bg-green-100 px-3 py-1">
            <Feather name="check-circle" size={13} color="#16A34A" />
            <Text className="text-xs font-medium text-green-700">Tasdiqlangan</Text>
          </View>
        )}
      </View>

      <TouchableOpacity
        className="mt-10 flex-row items-center justify-center gap-2 rounded-xl border border-red-200 py-3 dark:border-red-900"
        onPress={confirmSignOut}
      >
        <Feather name="log-out" size={18} color="#DC2626" />
        <Text className="font-semibold text-red-600">Chiqish</Text>
      </TouchableOpacity>
    </View>
  );
}
