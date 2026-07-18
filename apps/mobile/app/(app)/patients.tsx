import { useState } from 'react';
import { FlatList, Linking, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { EmptyView, ErrorView, LoadingView } from '../../src/components/ui/state-views';

type PatientRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  mrn: string | null;
  dob: string | null;
  gender: string | null;
};

function age(dob: string | null): string | null {
  if (!dob) return null;
  const years = Math.floor((Date.now() - Date.parse(dob)) / (365.25 * 24 * 3600 * 1000));
  return Number.isFinite(years) && years >= 0 ? `${years} yosh` : null;
}

// C3 — bo'sh qobiq edi (qidiruv hech narsa qilmasdi); endi real patients API.
export default function PatientsScreen() {
  const { clinicId } = useAuth();
  const [q, setQ] = useState('');

  const query = useQuery({
    queryKey: ['m-patients', q],
    queryFn: () => staffApi.patients.list({ page: 1, pageSize: 50, q: q.trim() || undefined }),
    enabled: !!clinicId,
  });
  const items = ((query.data?.items ?? []) as PatientRow[]);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-1 p-4">
        <Text className="text-2xl font-bold dark:text-white">Bemorlar</Text>
        <View className="mt-3 flex-row items-center rounded-lg border border-gray-300 px-3 dark:border-gray-700">
          <Feather name="search" size={16} color="#9CA3AF" />
          <TextInput
            className="h-11 flex-1 px-2 dark:text-white"
            placeholder="Ism, telefon yoki MRN…"
            placeholderTextColor="#9CA3AF"
            value={q}
            onChangeText={setQ}
            autoCorrect={false}
          />
          {q.length > 0 && (
            <TouchableOpacity onPress={() => setQ('')}>
              <Feather name="x" size={16} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>

        {query.isLoading ? (
          <LoadingView />
        ) : query.isError ? (
          <ErrorView message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
        ) : items.length === 0 ? (
          <EmptyView
            icon="users"
            title={q ? 'Topilmadi' : 'Bemorlar yo‘q'}
            subtitle={q ? 'Boshqa so‘z bilan qidirib ko‘ring' : 'Bemorlar qabulxonada ro‘yxatga olinadi'}
          />
        ) : (
          <FlatList
            className="mt-3"
            data={items}
            keyExtractor={(p) => p.id}
            ItemSeparatorComponent={() => <View className="h-2" />}
            renderItem={({ item: p }) => (
              <View className="flex-row items-center justify-between rounded-xl border border-gray-200 p-3 dark:border-gray-800">
                <View className="flex-1 pr-2">
                  <Text className="font-semibold dark:text-white" numberOfLines={1}>
                    {p.full_name?.trim() || '—'}
                  </Text>
                  <Text className="mt-0.5 text-xs text-gray-500">
                    {[p.mrn ? `MRN ${p.mrn}` : null, age(p.dob), p.phone]
                      .filter(Boolean)
                      .join(' · ') || 'Ma’lumot yo‘q'}
                  </Text>
                </View>
                {p.phone && (
                  <TouchableOpacity
                    onPress={() => void Linking.openURL(`tel:${p.phone}`)}
                    className="h-9 w-9 items-center justify-center rounded-full bg-emerald-500/10"
                  >
                    <Feather name="phone" size={16} color="#059669" />
                  </TouchableOpacity>
                )}
              </View>
            )}
          />
        )}
      </View>
    </SafeAreaView>
  );
}
