import { useMemo, useState } from 'react';
import {
  View, Text, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { computeShiftStatus, ShiftBanner, type Segment } from '../../src/components/nurse/shift-banner';
import { ClinicTaskCard } from '../../src/components/nurse/clinic-task-card';
import { HomeCallCard, type HomeCall } from '../../src/components/nurse/home-call-card';
import { ChatModal } from '../../src/components/nurse/chat-modal';
import { CLINIC_ACTIVE, HOME_ACTIVE } from '../../src/components/nurse/task-labels';

export default function NurseDashboard() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { session, clinicId } = useAuth();
  const userId = session?.user?.id ?? null;
  const [override, setOverride] = useState<Segment | null>(null);
  const [chatTask, setChatTask] = useState<HomeCall | null>(null);

  // ── Queries ───────────────────────────────────────────────────────────────
  const schedulesQ = useQuery({
    queryKey: ['nurse', 'schedules'],
    queryFn: () => staffApi.nurse.listSchedules(),
    enabled: !!clinicId,
  });
  const mineQ = useQuery({
    queryKey: ['nurse', 'clinic-tasks', 'mine'],
    queryFn: () => staffApi.nurse.listTasks({ mine: true }),
    enabled: !!clinicId,
    refetchInterval: 30_000,
  });
  const pendingQ = useQuery({
    queryKey: ['nurse', 'clinic-tasks', 'pending'],
    queryFn: () => staffApi.nurse.listTasks({ status: 'pending' }),
    enabled: !!clinicId,
    refetchInterval: 30_000,
  });
  const homeQ = useQuery({
    queryKey: ['nurse', 'home-calls'],
    queryFn: () => staffApi.nursePortal.tasks(),
    refetchInterval: 30_000,
  });

  // ── Derived ─────────────────────────────────────────────────────────────────
  const shift = useMemo(
    () => computeShiftStatus(schedulesQ.data ?? [], userId),
    [schedulesQ.data, userId],
  );
  const segment: Segment = !clinicId ? 'home' : (override ?? shift.defaultSegment);

  const mineActive = (mineQ.data ?? []).filter((t) => CLINIC_ACTIVE.includes(t.status));
  const claimable = (pendingQ.data ?? []).filter((t) => t.assigned_to == null);
  const homeActive = (homeQ.data ?? []).filter((t) => HOME_ACTIVE.includes(t.status));

  const clinicCount = mineActive.length + claimable.length;
  const homeCount = homeActive.length;

  // ── Mutations ────────────────────────────────────────────────────────────────
  const invClinic = () => {
    qc.invalidateQueries({ queryKey: ['nurse', 'clinic-tasks'] });
  };
  const invHome = () => qc.invalidateQueries({ queryKey: ['nurse', 'home-calls'] });
  const onErr = (e: unknown) => Alert.alert('Xato', (e as Error).message);

  const startClinic = useMutation({
    mutationFn: (id: string) => staffApi.nurse.updateTask(id, { status: 'in_progress' }),
    onSuccess: invClinic, onError: onErr,
  });
  const doneClinic = useMutation({
    mutationFn: (id: string) => staffApi.nurse.updateTask(id, { status: 'done' }),
    onSuccess: invClinic, onError: onErr,
  });
  const claimClinic = useMutation({
    mutationFn: (id: string) => staffApi.nurse.claimTask(id),
    onSuccess: invClinic, onError: onErr,
  });
  const startHome = useMutation({
    mutationFn: (id: string) => staffApi.nursePortal.startTask(id),
    onSuccess: invHome, onError: onErr,
  });
  const doneHome = useMutation({
    mutationFn: (id: string) => staffApi.nursePortal.completeTask(id),
    onSuccess: invHome, onError: onErr,
  });

  const refreshing =
    mineQ.isRefetching || pendingQ.isRefetching || homeQ.isRefetching || schedulesQ.isRefetching;
  const refetchAll = () => {
    homeQ.refetch();
    if (clinicId) { mineQ.refetch(); pendingQ.refetch(); schedulesQ.refetch(); }
  };

  const loading = clinicId
    ? (mineQ.isLoading || pendingQ.isLoading || homeQ.isLoading)
    : homeQ.isLoading;

  return (
    <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top + 12 }}>
      <Text className="px-4 text-2xl font-bold dark:text-white">Bosh sahifa</Text>

      <ShiftBanner status={shift} />

      {/* Segment toggle — faqat klinika xodimi (clinic_id bor) uchun */}
      {clinicId ? (
        <View className="mt-3 flex-row gap-2 px-4">
          <SegBtn
            active={segment === 'clinic'}
            label="Klinika ishlari"
            count={clinicCount}
            onPress={() => setOverride('clinic')}
          />
          <SegBtn
            active={segment === 'home'}
            label="Uy chaqiruvlari"
            count={homeCount}
            onPress={() => setOverride('home')}
          />
        </View>
      ) : (
        <Text className="mt-3 px-4 text-sm text-gray-500 dark:text-gray-400">Uy chaqiruvlari</Text>
      )}

      {loading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#2563EB" /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetchAll} />}
        >
          {segment === 'clinic' ? (
            <>
              <SectionTitle icon="user-check" text={`Mening vazifalarim (${mineActive.length})`} />
              {mineActive.length === 0 ? (
                <Empty text="Faol vazifa yo'q" />
              ) : (
                mineActive.map((t) => (
                  <ClinicTaskCard
                    key={t.id}
                    task={t}
                    variant="mine"
                    onStart={startClinic.mutate}
                    onComplete={doneClinic.mutate}
                    onClaim={claimClinic.mutate}
                    busy={startClinic.isPending || doneClinic.isPending}
                  />
                ))
              )}

              <SectionTitle icon="inbox" text={`Bo'sh vazifalar (${claimable.length})`} />
              {claimable.length === 0 ? (
                <Empty text="Bo'sh vazifa yo'q" />
              ) : (
                claimable.map((t) => (
                  <ClinicTaskCard
                    key={t.id}
                    task={t}
                    variant="claimable"
                    onStart={startClinic.mutate}
                    onComplete={doneClinic.mutate}
                    onClaim={claimClinic.mutate}
                    busy={claimClinic.isPending}
                  />
                ))
              )}
            </>
          ) : (
            <>
              {homeActive.length === 0 ? (
                <View className="mt-16 items-center">
                  <Feather name="home" size={36} color="#9CA3AF" />
                  <Text className="mt-3 text-center text-gray-500">Uy chaqiruvi yo'q</Text>
                </View>
              ) : (
                homeActive.map((item) => (
                  <HomeCallCard
                    key={item.id}
                    item={item}
                    onStart={startHome.mutate}
                    onComplete={doneHome.mutate}
                    onChat={setChatTask}
                    busy={startHome.isPending || doneHome.isPending}
                  />
                ))
              )}
            </>
          )}
        </ScrollView>
      )}

      {chatTask && <ChatModal task={chatTask} onClose={() => setChatTask(null)} />}
    </View>
  );
}

function SegBtn({
  active, label, count, onPress,
}: { active: boolean; label: string; count: number; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-1 flex-row items-center justify-center gap-1.5 rounded-full py-2 ${active ? 'bg-blue-600' : 'bg-gray-100 dark:bg-gray-800'}`}
    >
      <Text className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-600 dark:text-gray-300'}`}>
        {label}
      </Text>
      {count > 0 ? (
        <View className={`rounded-full px-1.5 ${active ? 'bg-white/25' : 'bg-blue-600'}`}>
          <Text className={`text-[11px] font-bold ${active ? 'text-white' : 'text-white'}`}>{count}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function SectionTitle({ icon, text }: { icon: keyof typeof Feather.glyphMap; text: string }) {
  return (
    <View className="mt-1 flex-row items-center gap-2">
      <Feather name={icon} size={14} color="#6B7280" />
      <Text className="text-sm font-semibold text-gray-700 dark:text-gray-200">{text}</Text>
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View className="items-center rounded-2xl border border-dashed border-gray-200 py-6 dark:border-gray-800">
      <Text className="text-sm text-gray-400">{text}</Text>
    </View>
  );
}
