import { useState } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { patientApi } from '../../src/lib/api';

interface Clinic {
  id: string;
  slug: string;
  name: string;
  city: string | null;
  address: string | null;
  logo_url: string | null;
  rating?: { avg_rating: number | null; review_count: number | null } | null;
  web_profile?: { tagline: string | null; specialties: string[] | null } | null;
}

export default function ClinicsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['patient', 'clinics', search],
    queryFn: () => patientApi.patient.searchClinics({ query: search || undefined }),
  });

  // Backend `{ data, total }` qaytaradi; eski variant uchun `items` ham qo'llab-quvvatlanadi.
  const resp = data as { data?: Clinic[]; items?: Clinic[] } | undefined;
  const clinics = (resp?.data ?? resp?.items ?? []) as Clinic[];

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top + 12 }}>
      <View className="px-4">
        <Text className="text-2xl font-bold dark:text-white">Klinikalar</Text>
        <View className="mt-3 flex-row items-center gap-2 rounded-xl border border-gray-300 px-3 dark:border-gray-700">
          <Feather name="search" size={18} color="#9CA3AF" />
          <TextInput
            className="h-11 flex-1 dark:text-white"
            placeholder="Klinika nomi bo'yicha qidirish"
            placeholderTextColor="#9CA3AF"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={() => setSearch(query.trim())}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setSearch(''); }}>
              <Feather name="x" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Feather name="wifi-off" size={32} color="#9CA3AF" />
          <Text className="mt-2 text-center text-gray-500">{(error as Error).message}</Text>
          <TouchableOpacity className="mt-4 rounded-lg bg-blue-600 px-4 py-2" onPress={() => refetch()}>
            <Text className="font-semibold text-white">Qayta urinish</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={clinics}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
          ListEmptyComponent={
            <Text className="mt-12 text-center text-gray-500">Klinika topilmadi</Text>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900"
              onPress={() => router.push(`/(patient)/clinic/${item.slug}`)}
            >
              <View className="flex-row items-center justify-between">
                <Text className="flex-1 text-lg font-semibold dark:text-white">{item.name}</Text>
                {item.rating?.avg_rating != null && (
                  <View className="flex-row items-center gap-1">
                    <Feather name="star" size={14} color="#F59E0B" />
                    <Text className="text-sm font-medium text-amber-600">
                      {item.rating.avg_rating.toFixed(1)}
                    </Text>
                  </View>
                )}
              </View>
              {item.web_profile?.tagline ? (
                <Text className="mt-1 text-sm text-gray-500 dark:text-gray-400">{item.web_profile.tagline}</Text>
              ) : null}
              <View className="mt-2 flex-row items-center gap-1">
                <Feather name="map-pin" size={13} color="#9CA3AF" />
                <Text className="text-sm text-gray-500 dark:text-gray-400">
                  {[item.city, item.address].filter(Boolean).join(', ') || 'Manzil ko\'rsatilmagan'}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}
