import { useState } from 'react';
import { Alert, View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { patientApi } from '../../src/lib/api';
import { usePatientAuth } from '../../src/providers/patient-auth-provider';

// M4 — "Hozirda X klinikasida davolanyapsiz" kartasi: telefon raqami klinika
// qabulxonasida ro'yxatda bo'lsa ko'rinadi; statsionarda yotsa xona/qavat +
// "Hamshira chaqirish" (chaqiruv o'sha klinika hamshiralariga tushadi).
function TreatmentCard() {
  const [calledStay, setCalledStay] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['patient', 'treatment'],
    queryFn: () => patientApi.patient.treatmentStatus(),
    refetchInterval: 60_000,
  });
  const callMut = useMutation({
    mutationFn: (stayId: string) => patientApi.patient.inpatientNurseCall(stayId),
    onSuccess: (r, stayId) => {
      setCalledStay(stayId);
      Alert.alert(
        'Hamshira chaqirildi',
        r.already
          ? 'Chaqiruvingiz allaqachon yuborilgan — hamshira yo‘lda.'
          : 'So‘rov hamshiralarga yuborildi. Iltimos, kuting.',
      );
    },
    onError: (e: Error) => Alert.alert('Xatolik', e.message),
  });

  const treatments = q.data?.treatments ?? [];
  if (treatments.length === 0) return null;

  return (
    <View className="mt-6 gap-3">
      {treatments.map((t) => (
        <View
          key={t.clinic_patient_id}
          className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950"
        >
          <View className="flex-row items-center gap-2">
            <Feather name="activity" size={16} color="#059669" />
            <Text className="flex-1 text-sm font-semibold text-emerald-800 dark:text-emerald-300">
              Hozirda {t.clinic?.name ?? 'klinikada'} davolanyapsiz
            </Text>
          </View>

          {t.inpatient && (
            <>
              <View className="mt-3 flex-row items-center gap-2">
                <Feather name="home" size={14} color="#059669" />
                <Text className="text-sm text-emerald-800 dark:text-emerald-300">
                  {t.inpatient.room
                    ? `Xona ${t.inpatient.room.number}` +
                      (t.inpatient.room.floor != null ? ` · ${t.inpatient.room.floor}-qavat` : '') +
                      (t.inpatient.room.name ? ` · ${t.inpatient.room.name}` : '')
                    : 'Statsionarda yotibsiz'}
                </Text>
              </View>
              <TouchableOpacity
                disabled={callMut.isPending || calledStay === t.inpatient.stay_id}
                onPress={() =>
                  Alert.alert('Hamshira chaqirish', 'Hamshira chaqirilsinmi?', [
                    { text: 'Bekor', style: 'cancel' },
                    { text: 'Chaqirish', onPress: () => callMut.mutate(t.inpatient!.stay_id) },
                  ])
                }
                className={
                  'mt-3 flex-row items-center justify-center gap-2 rounded-xl py-3 ' +
                  (calledStay === t.inpatient.stay_id ? 'bg-emerald-300' : 'bg-emerald-600')
                }
              >
                <Feather name="bell" size={16} color="white" />
                <Text className="font-semibold text-white">
                  {calledStay === t.inpatient.stay_id ? 'Chaqiruv yuborildi ✓' : 'Hamshira chaqirish'}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ))}
    </View>
  );
}

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

      <TreatmentCard />

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
