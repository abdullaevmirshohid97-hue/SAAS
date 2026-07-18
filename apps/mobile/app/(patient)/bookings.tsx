import { View, Text, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { patientApi } from '../../src/lib/api';
import { ErrorView } from '../../src/components/ui/state-views';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Kutilmoqda', cls: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'Tasdiqlangan', cls: 'bg-green-100 text-green-700' },
  rejected: { label: 'Rad etilgan', cls: 'bg-red-100 text-red-700' },
  canceled: { label: 'Bekor qilingan', cls: 'bg-gray-200 text-gray-600' },
  completed: { label: 'Yakunlangan', cls: 'bg-blue-100 text-blue-700' },
};

function fmt(s: string | null) {
  if (!s) return null;
  try { return new Date(s).toLocaleString('uz-UZ', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return s; }
}

export default function BookingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['patient', 'appointments'],
    queryFn: () => patientApi.patient.myAppointments(),
  });

  const cancelM = useMutation({
    mutationFn: (id: string) => patientApi.patient.cancelAppointment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patient', 'appointments'] }),
    onError: (e) => Alert.alert('Xato', (e as Error).message),
  });

  const items = data ?? [];

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top + 12 }}>
      <Text className="px-4 text-2xl font-bold dark:text-white">Navbatlarim</Text>

      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>
      ) : isError ? (
        // C7 — xato bo'lsa "navbat yo'q" degan yolg'on bo'sh holat emas, aniq xabar.
        <ErrorView message={(error as Error)?.message} onRetry={() => void refetch()} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(b) => b.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <View className="mt-16 items-center">
              <Feather name="calendar" size={36} color="#9CA3AF" />
              <Text className="mt-3 text-center text-gray-500">Hozircha navbatingiz yo'q</Text>
              <TouchableOpacity className="mt-4 rounded-lg bg-blue-600 px-4 py-2" onPress={() => router.push('/(patient)/clinics')}>
                <Text className="font-semibold text-white">Klinika tanlash</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => {
            const st = STATUS[item.status] ?? { label: item.status, cls: 'bg-gray-100 text-gray-600' };
            const canCancel = ['pending', 'confirmed'].includes(item.status);
            return (
              <View className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                <View className="flex-row items-center justify-between">
                  <Text className="flex-1 text-lg font-semibold dark:text-white">{item.clinic?.name ?? 'Klinika'}</Text>
                  <View className={`rounded-full px-2 py-0.5 ${st.cls.split(' ')[0]}`}>
                    <Text className={`text-xs font-medium ${st.cls.split(' ')[1]}`}>{st.label}</Text>
                  </View>
                </View>

                {item.doctor_name ? (
                  <View className="mt-2 flex-row items-center gap-1">
                    <Feather name="user" size={13} color="#9CA3AF" />
                    <Text className="text-sm text-gray-600 dark:text-gray-300">Dr. {item.doctor_name}</Text>
                  </View>
                ) : null}
                {item.preferred_note ? (
                  <View className="mt-1 flex-row items-center gap-1">
                    <Feather name="clock" size={13} color="#9CA3AF" />
                    <Text className="text-sm text-gray-600 dark:text-gray-300">Qulay vaqt: {item.preferred_note}</Text>
                  </View>
                ) : null}
                {item.scheduled_at ? (
                  <View className="mt-1 flex-row items-center gap-1">
                    <Feather name="check-circle" size={13} color="#16A34A" />
                    <Text className="text-sm font-medium text-green-700">Belgilangan vaqt: {fmt(item.scheduled_at)}</Text>
                  </View>
                ) : null}
                {item.reason ? <Text className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.reason}</Text> : null}
                {item.response_note ? (
                  <Text className="mt-1 text-sm text-blue-700">Klinika javobi: {item.response_note}</Text>
                ) : null}

                {canCancel ? (
                  <TouchableOpacity
                    className="mt-3 self-start rounded-lg border border-red-200 px-3 py-1.5 dark:border-red-900"
                    onPress={() =>
                      Alert.alert('Bekor qilish', 'Navbat so\'rovini bekor qilasizmi?', [
                        { text: 'Yo\'q', style: 'cancel' },
                        { text: 'Ha', style: 'destructive', onPress: () => cancelM.mutate(item.id) },
                      ])
                    }
                  >
                    <Text className="text-sm font-medium text-red-600">Bekor qilish</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}
