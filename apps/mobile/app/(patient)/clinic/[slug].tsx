import { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { patientApi } from '../../../src/lib/api';

interface Doctor { id: string; full_name: string; specialization?: string | null }
interface ClinicDetail {
  id: string;
  name: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  web_profile?: { tagline: string | null; description: string | null } | null;
  rating?: { avg_rating: number | null; review_count: number | null } | null;
  doctors?: Doctor[];
}

const TIME_CHIPS = [
  { key: 'Ertalab', label: 'Ertalab' },
  { key: 'Tushdan keyin', label: 'Tushdan keyin' },
  { key: 'Kechqurun', label: 'Kechqurun' },
  { key: 'Farqi yo\'q', label: "Farqi yo'q" },
];

export default function ClinicDetailScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { slug } = useLocalSearchParams<{ slug: string }>();

  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [timeNote, setTimeNote] = useState<string>("Farqi yo'q");
  const [reason, setReason] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['patient', 'clinic', slug],
    queryFn: () => patientApi.patient.getClinic(slug) as Promise<ClinicDetail>,
    enabled: !!slug,
  });

  const mutation = useMutation({
    mutationFn: () =>
      patientApi.patient.requestAppointment({
        clinic_id: data!.id,
        doctor_id: doctorId,
        preferred_note: timeNote,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', 'appointments'] });
      Alert.alert('Yuborildi', 'Navbat so\'rovingiz klinikaga yuborildi. Tasdiqlanishini kuting.', [
        { text: 'OK', onPress: () => router.replace('/(patient)/bookings') },
      ]);
    },
    onError: (e) => Alert.alert('Xato', (e as Error).message),
  });

  if (isLoading) {
    return <View className="flex-1 items-center justify-center bg-white dark:bg-black"><ActivityIndicator color="#2563EB" /></View>;
  }
  if (isError || !data) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-black">
        <Text className="text-gray-500">Klinika topilmadi</Text>
        <TouchableOpacity className="mt-4" onPress={() => router.back()}><Text className="text-blue-600">Orqaga</Text></TouchableOpacity>
      </View>
    );
  }

  const doctors = data.doctors ?? [];

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, padding: 16, paddingBottom: 40 }}>
        <TouchableOpacity className="mb-2" onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#6B7280" />
        </TouchableOpacity>

        <Text className="text-2xl font-bold dark:text-white">{data.name}</Text>
        {data.web_profile?.tagline ? (
          <Text className="mt-1 text-gray-500 dark:text-gray-400">{data.web_profile.tagline}</Text>
        ) : null}
        <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {data.rating?.avg_rating != null && (
            <View className="flex-row items-center gap-1">
              <Feather name="star" size={14} color="#F59E0B" />
              <Text className="text-sm text-amber-600">{data.rating.avg_rating.toFixed(1)}</Text>
            </View>
          )}
          {(data.city || data.address) && (
            <View className="flex-row items-center gap-1">
              <Feather name="map-pin" size={13} color="#9CA3AF" />
              <Text className="text-sm text-gray-500 dark:text-gray-400">{[data.city, data.address].filter(Boolean).join(', ')}</Text>
            </View>
          )}
        </View>

        {/* Navbat olish formasi */}
        <Text className="mt-6 text-lg font-semibold dark:text-white">Navbat olish</Text>

        {/* Shifokor (ixtiyoriy) */}
        <Text className="mt-4 text-sm font-medium text-gray-600 dark:text-gray-300">Shifokor (ixtiyoriy)</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          <Chip label="Farqi yo'q" active={doctorId === null} onPress={() => setDoctorId(null)} />
          {doctors.map((d) => (
            <Chip key={d.id} label={d.full_name} active={doctorId === d.id} onPress={() => setDoctorId(d.id)} />
          ))}
        </View>

        {/* Qulay vaqt */}
        <Text className="mt-5 text-sm font-medium text-gray-600 dark:text-gray-300">Qulay vaqt</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {TIME_CHIPS.map((t) => (
            <Chip key={t.key} label={t.label} active={timeNote === t.key} onPress={() => setTimeNote(t.key)} />
          ))}
        </View>

        {/* Sabab */}
        <Text className="mt-5 text-sm font-medium text-gray-600 dark:text-gray-300">Murojaat sababi (ixtiyoriy)</Text>
        <TextInput
          className="mt-2 min-h-[80px] rounded-xl border border-gray-300 p-3 dark:border-gray-700 dark:text-white"
          placeholder="Masalan: bosh og'rigi, shamollash..."
          placeholderTextColor="#9CA3AF"
          multiline
          value={reason}
          onChangeText={setReason}
          textAlignVertical="top"
        />

        <TouchableOpacity
          className="mt-6 h-12 items-center justify-center rounded-xl bg-blue-600"
          onPress={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? <ActivityIndicator color="white" /> : <Text className="text-base font-semibold text-white">Navbat so'rovini yuborish</Text>}
        </TouchableOpacity>
        <Text className="mt-2 text-center text-xs text-gray-400">
          So'rov klinikaga yuboriladi va tasdiqlangach sizga xabar beriladi
        </Text>
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`rounded-full border px-4 py-2 ${active ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-700'}`}
    >
      <Text className={`text-sm ${active ? 'font-semibold text-white' : 'text-gray-700 dark:text-gray-300'}`}>{label}</Text>
    </TouchableOpacity>
  );
}
