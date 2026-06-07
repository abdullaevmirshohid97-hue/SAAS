import { useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Image, ActivityIndicator, RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { supabase } from '../../src/lib/supabase';
import {
  dayLabel, dateLabel, CLINIC_ACTIVE, HOME_ACTIVE,
} from '../../src/components/nurse/task-labels';

export default function NurseProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { session, role, clinicId } = useAuth();
  const userId = session?.user?.id ?? null;

  const profileQ = useQuery({
    queryKey: ['nurse', 'my-profile'],
    queryFn: () => staffApi.nursePortal.myProfile(),
  });
  const schedulesQ = useQuery({
    queryKey: ['nurse', 'schedules'],
    queryFn: () => staffApi.nurse.listSchedules(),
    enabled: !!clinicId,
  });
  const mineQ = useQuery({
    queryKey: ['nurse', 'clinic-tasks', 'mine'],
    queryFn: () => staffApi.nurse.listTasks({ mine: true }),
    enabled: !!clinicId,
  });
  const homeQ = useQuery({
    queryKey: ['nurse', 'home-calls'],
    queryFn: () => staffApi.nursePortal.tasks(),
  });

  const p = profileQ.data;
  const name = p?.full_name ?? session?.user?.user_metadata?.full_name ?? '—';
  const email = p?.email ?? session?.user?.email ?? '—';

  const mySchedules = useMemo(
    () =>
      (schedulesQ.data ?? [])
        .filter((s) => s.nurse_id === userId && s.is_active)
        .sort((a, b) => a.day_of_week - b.day_of_week || a.start_time.localeCompare(b.start_time)),
    [schedulesQ.data, userId],
  );

  const pendingCount =
    (mineQ.data ?? []).filter((t) => CLINIC_ACTIVE.includes(t.status)).length +
    (homeQ.data ?? []).filter((t) => HOME_ACTIVE.includes(t.status)).length;

  // Xizmatlar tarixi: bajarilgan klinika vazifalari + tugagan uy chaqiruvlari
  const history = useMemo(() => {
    const clinicDone = (mineQ.data ?? [])
      .filter((t) => t.status === 'done')
      .map((t) => ({
        id: `c-${t.id}`,
        kind: 'clinic' as const,
        title: t.title,
        subtitle: t.patient?.full_name ?? null,
        date: t.completed_at ?? t.created_at,
      }));
    const homeDone = (homeQ.data ?? [])
      .filter((t) => t.status === 'completed')
      .map((t) => ({
        id: `h-${t.id}`,
        kind: 'home' as const,
        title: t.service,
        subtitle: t.address ?? t.requester_name,
        date: t.created_at,
      }));
    return [...clinicDone, ...homeDone].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );
  }, [mineQ.data, homeQ.data]);

  const refreshing = profileQ.isRefetching || schedulesQ.isRefetching || mineQ.isRefetching || homeQ.isRefetching;
  const refetchAll = () => {
    profileQ.refetch(); homeQ.refetch();
    if (clinicId) { schedulesQ.refetch(); mineQ.refetch(); }
  };

  function signOut() {
    Alert.alert('Chiqish', 'Akkauntdan chiqmoqchimisiz?', [
      { text: 'Bekor qilish', style: 'cancel' },
      {
        text: 'Chiqish',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/');
        },
      },
    ]);
  }

  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      contentContainerStyle={{ paddingTop: insets.top + 16, paddingHorizontal: 16, paddingBottom: insets.bottom + 24 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} />}
    >
      <Text className="text-2xl font-bold dark:text-white">Profil</Text>

      {/* ── Shaxsiy ── */}
      <View className="mt-5 items-center">
        {p?.photo_url ? (
          <Image source={{ uri: p.photo_url }} className="h-20 w-20 rounded-full" />
        ) : (
          <View className="h-20 w-20 items-center justify-center rounded-full bg-blue-100">
            <Feather name="user" size={36} color="#2563EB" />
          </View>
        )}
        <Text className="mt-3 text-lg font-semibold dark:text-white">{name}</Text>
        <Text className="text-sm text-gray-500 dark:text-gray-400">{email}</Text>
        <View className="mt-2 flex-row items-center gap-1 rounded-full bg-blue-100 px-3 py-1">
          <Feather name="heart" size={13} color="#2563EB" />
          <Text className="text-xs font-medium text-blue-700">
            Hamshira{role && role !== 'nurse' ? ` (${role})` : ''}
          </Text>
        </View>
      </View>

      <View className="mt-5 rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
        <InfoRow icon="home" label="Klinika" value={p?.clinic?.name ?? '—'} />
        {p?.clinic?.city ? <InfoRow icon="map-pin" label="Shahar" value={p.clinic.city} /> : null}
        {p?.phone ? <InfoRow icon="phone" label="Telefon" value={p.phone} /> : null}
        {p?.specialization ? <InfoRow icon="award" label="Mutaxassislik" value={p.specialization} /> : null}
        <InfoRow icon="check-circle" label="Bajarilishi kerak" value={`${pendingCount} ta xizmat`} />
      </View>

      {/* ── Navbatchilik grafigim ── */}
      <SectionHeader icon="calendar" text="Navbatchilik grafigim" />
      {!clinicId ? (
        <Hint text="Navbatchilik jadvali klinika xodimlari uchun." />
      ) : schedulesQ.isLoading ? (
        <Loader />
      ) : mySchedules.length === 0 ? (
        <Hint text="Hali navbat belgilanmagan. Klinika administratori jadvalni to'ldiradi." />
      ) : (
        <View className="rounded-2xl border border-gray-100 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-900">
          {mySchedules.map((s, i) => (
            <View
              key={s.id}
              className={`flex-row items-center justify-between px-3 py-2.5 ${i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}
            >
              <View className="h-8 w-8 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
                <Text className="text-xs font-bold text-blue-700">{dayLabel(s.day_of_week)}</Text>
              </View>
              <Text className="flex-1 px-3 text-sm text-gray-700 dark:text-gray-200">{s.floor}-qavat</Text>
              <Text className="font-mono text-xs text-gray-500 dark:text-gray-400">
                {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Xizmatlar tarixi ── */}
      <SectionHeader icon="clock" text="Xizmatlar tarixi" />
      {history.length === 0 ? (
        <Hint text="Hali bajarilgan xizmat yo'q." />
      ) : (
        <View className="rounded-2xl border border-gray-100 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-900">
          {history.slice(0, 50).map((h, i) => (
            <View
              key={h.id}
              className={`flex-row items-center gap-3 px-3 py-2.5 ${i > 0 ? 'border-t border-gray-100 dark:border-gray-800' : ''}`}
            >
              <Text className="text-base">{h.kind === 'clinic' ? '🏥' : '🏠'}</Text>
              <View className="flex-1">
                <Text className="text-sm font-medium text-gray-800 dark:text-gray-100" numberOfLines={1}>
                  {h.title}
                </Text>
                {h.subtitle ? (
                  <Text className="text-xs text-gray-500 dark:text-gray-400" numberOfLines={1}>
                    {h.subtitle}
                  </Text>
                ) : null}
              </View>
              <Text className="text-[11px] text-gray-400">{dateLabel(h.date) ?? ''}</Text>
            </View>
          ))}
        </View>
      )}

      {/* ── Chiqish ── */}
      <TouchableOpacity
        className="mt-6 flex-row items-center justify-center gap-2 rounded-xl border border-red-200 py-3 dark:border-red-900"
        onPress={signOut}
      >
        <Feather name="log-out" size={18} color="#DC2626" />
        <Text className="font-semibold text-red-600">Chiqish</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function InfoRow({
  icon, label, value,
}: { icon: keyof typeof Feather.glyphMap; label: string; value: string }) {
  return (
    <View className="flex-row items-center gap-3 py-1.5">
      <Feather name={icon} size={15} color="#9CA3AF" />
      <Text className="text-sm text-gray-500 dark:text-gray-400">{label}</Text>
      <Text className="flex-1 text-right text-sm font-medium text-gray-800 dark:text-gray-100">{value}</Text>
    </View>
  );
}

function SectionHeader({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View className="mb-2 mt-6 flex-row items-center gap-2">
      <Feather name={icon} size={16} color="#2563EB" />
      <Text className="text-base font-semibold dark:text-white">{text}</Text>
    </View>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <View className="rounded-2xl border border-dashed border-gray-200 px-4 py-4 dark:border-gray-800">
      <Text className="text-sm text-gray-400">{text}</Text>
    </View>
  );
}

function Loader() {
  return (
    <View className="items-center py-6">
      <ActivityIndicator color="#2563EB" />
    </View>
  );
}
