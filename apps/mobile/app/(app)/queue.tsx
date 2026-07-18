import { Alert, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { EmptyView, ErrorView, LoadingView } from '../../src/components/ui/state-views';

type QueueRow = {
  id: string;
  ticket_code: string | null;
  status: 'waiting' | 'called' | 'serving';
  joined_at: string;
  patient: { id: string; full_name: string | null; phone: string | null } | null;
  doctor: { id: string; full_name: string } | null;
};

const STATUS_META: Record<QueueRow['status'], { label: string; cls: string }> = {
  waiting: { label: 'Kutmoqda', cls: 'bg-sky-500/10 text-sky-600' },
  called: { label: 'Chaqirildi', cls: 'bg-amber-500/10 text-amber-600' },
  serving: { label: 'Qabulda', cls: 'bg-emerald-500/10 text-emerald-600' },
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' });
}

// C4 — "Supabase Realtime" degan yozuvgina edi; endi jonli ro'yxat (15s polling
// + pull-to-refresh) va holat amallari: chaqirish → qabul → yakunlash / o'tkazib yuborish.
export default function QueueScreen() {
  const { clinicId } = useAuth();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ['m-queue'],
    queryFn: () => staffApi.queues.list(),
    enabled: !!clinicId,
    refetchInterval: 15_000,
  });
  const rows = ((query.data ?? []) as QueueRow[]);

  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'call' | 'accept' | 'complete' | 'skip' }) => {
      if (action === 'call') return staffApi.queues.call(id);
      if (action === 'accept') return staffApi.queues.accept(id);
      if (action === 'complete') return staffApi.queues.complete(id);
      return staffApi.queues.skip(id);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['m-queue'] }),
    onError: (e: Error) => Alert.alert('Xatolik', e.message),
  });

  const nextAction = (r: QueueRow): { action: 'call' | 'accept' | 'complete'; label: string } =>
    r.status === 'waiting'
      ? { action: 'call', label: 'Chaqirish' }
      : r.status === 'called'
        ? { action: 'accept', label: 'Qabul' }
        : { action: 'complete', label: 'Yakunlash' };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      <View className="flex-1 p-4">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-bold dark:text-white">Navbat</Text>
          <Text className="text-xs text-gray-500">Jonli · 15s</Text>
        </View>

        {query.isLoading ? (
          <LoadingView />
        ) : query.isError ? (
          <ErrorView message={(query.error as Error)?.message} onRetry={() => query.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyView icon="users" title="Navbat bo‘sh" subtitle="Yangi bemor qo‘shilganda shu yerda ko‘rinadi" />
        ) : (
          <ScrollView
            className="mt-3"
            refreshControl={
              <RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} />
            }
          >
            {rows.map((r) => {
              const meta = STATUS_META[r.status];
              const next = nextAction(r);
              return (
                <View
                  key={r.id}
                  className="mb-2 rounded-xl border border-gray-200 p-3 dark:border-gray-800"
                >
                  <View className="flex-row items-center justify-between">
                    <View className="flex-row items-center gap-2">
                      <Text className="text-base font-bold dark:text-white">
                        {r.ticket_code ?? '—'}
                      </Text>
                      <View className={`rounded-full px-2 py-0.5 ${meta.cls.split(' ')[0]}`}>
                        <Text className={`text-[10px] font-semibold ${meta.cls.split(' ')[1]}`}>
                          {meta.label}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-xs text-gray-500">{fmtTime(r.joined_at)}</Text>
                  </View>
                  <Text className="mt-1 dark:text-white" numberOfLines={1}>
                    {r.patient?.full_name?.trim() || 'Bemor'}
                  </Text>
                  {r.doctor && (
                    <Text className="text-xs text-gray-500" numberOfLines={1}>
                      {r.doctor.full_name}
                    </Text>
                  )}
                  <View className="mt-2 flex-row gap-2">
                    <TouchableOpacity
                      disabled={act.isPending}
                      onPress={() => act.mutate({ id: r.id, action: next.action })}
                      className="flex-1 items-center rounded-lg bg-[#2563EB] py-2"
                    >
                      <Text className="text-sm font-semibold text-white">{next.label}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      disabled={act.isPending}
                      onPress={() =>
                        Alert.alert('O‘tkazib yuborish', `${r.ticket_code ?? ''} navbatdan chiqarilsinmi?`, [
                          { text: 'Bekor', style: 'cancel' },
                          { text: 'Ha', style: 'destructive', onPress: () => act.mutate({ id: r.id, action: 'skip' }) },
                        ])
                      }
                      className="items-center justify-center rounded-lg border border-gray-300 px-3 dark:border-gray-700"
                    >
                      <Feather name="skip-forward" size={16} color="#9CA3AF" />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}
