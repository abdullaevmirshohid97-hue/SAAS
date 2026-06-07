import { useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { patientApi } from '../../src/lib/api';

type Tab = 'diagnoses' | 'labs' | 'diagnostics';

function fmtDate(s: string | null) {
  if (!s) return '';
  try {
    return new Date(s).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return s.slice(0, 10);
  }
}

function Meta({ patient, clinic, date }: { patient: string | null; clinic: { name: string } | null; date: string | null }) {
  return (
    <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
      {patient ? (
        <View className="flex-row items-center gap-1">
          <Feather name="user" size={12} color="#9CA3AF" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">{patient}</Text>
        </View>
      ) : null}
      {clinic ? (
        <View className="flex-row items-center gap-1">
          <Feather name="home" size={12} color="#9CA3AF" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">{clinic.name}</Text>
        </View>
      ) : null}
      {date ? (
        <View className="flex-row items-center gap-1">
          <Feather name="calendar" size={12} color="#9CA3AF" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">{fmtDate(date)}</Text>
        </View>
      ) : null}
    </View>
  );
}

export default function HealthScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('diagnoses');

  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: ['patient', 'medical'],
    queryFn: () => patientApi.patient.medicalRecords(),
  });

  const diagnoses = data?.diagnoses ?? [];
  const labs = data?.labs ?? [];
  const diagnostics = data?.diagnostics ?? [];

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'diagnoses', label: 'Tashxislar', count: diagnoses.length },
    { key: 'labs', label: 'Analizlar', count: labs.length },
    { key: 'diagnostics', label: 'Tekshiruvlar', count: diagnostics.length },
  ];

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top + 12 }}>
      <Text className="px-4 text-2xl font-bold dark:text-white">Sog'lig'im</Text>
      <Text className="px-4 text-sm text-gray-500 dark:text-gray-400">Shifokor qo'ygan tashxis va natijalar</Text>

      {/* Segment */}
      <View className="mt-3 flex-row gap-2 px-4">
        {tabs.map((t) => (
          <TouchableOpacity
            key={t.key}
            onPress={() => setTab(t.key)}
            className={`flex-1 items-center rounded-full py-2 ${tab === t.key ? 'bg-blue-600' : 'bg-gray-100 dark:bg-gray-800'}`}
          >
            <Text className={`text-xs font-semibold ${tab === t.key ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`}>
              {t.label}{t.count > 0 ? ` (${t.count})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Feather name="alert-circle" size={32} color="#9CA3AF" />
          <Text className="mt-2 text-center text-gray-500">{(error as Error).message}</Text>
          <TouchableOpacity className="mt-4 rounded-lg bg-blue-600 px-4 py-2" onPress={() => refetch()}>
            <Text className="font-semibold text-white">Qayta urinish</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
        >
          {/* TASHXISLAR */}
          {tab === 'diagnoses' && (
            diagnoses.length === 0 ? (
              <Empty icon="clipboard" text="Hozircha tashxis yo'q" />
            ) : (
              diagnoses.map((d) => (
                <View key={d.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                  <View className="flex-row items-start justify-between gap-2">
                    <Text className="flex-1 text-base font-semibold dark:text-white">
                      {d.diagnosis_text || d.assessment || 'Tashxis'}
                    </Text>
                    {d.diagnosis_code ? (
                      <View className="rounded bg-blue-100 px-2 py-0.5">
                        <Text className="text-xs font-semibold text-blue-700">{d.diagnosis_code}</Text>
                      </View>
                    ) : null}
                  </View>
                  {d.plan ? (
                    <Text className="mt-1 text-sm text-gray-600 dark:text-gray-300">Tavsiya: {d.plan}</Text>
                  ) : null}
                  {d.doctor_name ? (
                    <View className="mt-2 flex-row items-center gap-1">
                      <Feather name="user-check" size={13} color="#2563EB" />
                      <Text className="text-sm font-medium text-blue-700">Dr. {d.doctor_name}</Text>
                    </View>
                  ) : null}
                  <Meta patient={d.patient_name} clinic={d.clinic} date={d.occurred_at} />
                </View>
              ))
            )
          )}

          {/* ANALIZLAR */}
          {tab === 'labs' && (
            labs.length === 0 ? (
              <Empty icon="droplet" text="Hozircha analiz yo'q" />
            ) : (
              labs.map((o) => (
                <View key={o.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                  <View className="flex-row items-center justify-between">
                    <Text className="font-semibold dark:text-white">Laborator buyurtma</Text>
                    <StatusBadge status={o.status} />
                  </View>
                  <View className="mt-2 gap-2">
                    {o.items.map((it, i) => (
                      <View key={i} className="rounded-lg bg-white p-2 dark:bg-gray-800">
                        <Text className="text-sm font-medium dark:text-gray-100">{it.name}</Text>
                        {it.results.length === 0 ? (
                          <Text className="text-xs text-gray-400">Natija kutilmoqda</Text>
                        ) : (
                          it.results.map((r, j) => (
                            <View key={j} className="mt-1 flex-row items-center justify-between">
                              <Text className={`text-sm font-semibold ${r.is_abnormal ? 'text-red-600' : 'text-green-700'}`}>
                                {r.value}{r.unit ? ` ${r.unit}` : ''}
                              </Text>
                              {r.reference_range ? (
                                <Text className="text-xs text-gray-400">Norma: {r.reference_range}</Text>
                              ) : null}
                            </View>
                          ))
                        )}
                      </View>
                    ))}
                  </View>
                  <Meta patient={o.patient_name} clinic={o.clinic} date={o.occurred_at} />
                </View>
              ))
            )
          )}

          {/* TEKSHIRUVLAR */}
          {tab === 'diagnostics' && (
            diagnostics.length === 0 ? (
              <Empty icon="activity" text="Hozircha tekshiruv yo'q" />
            ) : (
              diagnostics.map((o) => (
                <View key={o.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 font-semibold dark:text-white">{o.name || 'Tekshiruv'}</Text>
                    <StatusBadge status={o.status} />
                  </View>
                  {o.results.map((r, i) => (
                    <View key={i} className="mt-2">
                      {r.impression ? <Text className="text-sm font-medium dark:text-gray-100">Xulosa: {r.impression}</Text> : null}
                      {r.findings ? <Text className="mt-1 text-sm text-gray-600 dark:text-gray-300">{r.findings}</Text> : null}
                    </View>
                  ))}
                  <Meta patient={o.patient_name} clinic={o.clinic} date={o.occurred_at} />
                </View>
              ))
            )
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View className="mt-16 items-center">
      <Feather name={icon} size={36} color="#9CA3AF" />
      <Text className="mt-3 text-center text-gray-500">{text}</Text>
    </View>
  );
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Kutilmoqda',
  received: 'Qabul qilindi',
  running: 'Bajarilmoqda',
  completed: 'Tayyor',
  reported: 'Yakunlandi',
  delivered: 'Topshirildi',
  canceled: 'Bekor',
};

function StatusBadge({ status }: { status: string }) {
  const done = ['completed', 'reported', 'delivered'].includes(status);
  return (
    <View className={`rounded-full px-2 py-0.5 ${done ? 'bg-green-100' : 'bg-amber-100'}`}>
      <Text className={`text-xs font-medium ${done ? 'text-green-700' : 'text-amber-700'}`}>
        {STATUS_LABEL[status] ?? status}
      </Text>
    </View>
  );
}
