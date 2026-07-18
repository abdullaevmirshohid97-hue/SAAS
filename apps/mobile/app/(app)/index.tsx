import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { ErrorView, LoadingView } from '../../src/components/ui/state-views';

const fmtUzs = (n: number) => `${Math.round(n ?? 0).toLocaleString('uz-UZ')} so'm`;

function StatCard({
  icon,
  label,
  value,
  tone = 'default',
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  tone?: 'default' | 'green' | 'amber';
}) {
  const toneCls =
    tone === 'green' ? 'text-emerald-600' : tone === 'amber' ? 'text-amber-600' : 'dark:text-white';
  return (
    <View className="flex-1 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
      <View className="flex-row items-center gap-2">
        <Feather name={icon} size={16} color="#6B7280" />
        <Text className="text-xs text-gray-500">{label}</Text>
      </View>
      <Text className={`mt-2 text-xl font-bold ${toneCls}`}>{value}</Text>
    </View>
  );
}

// C2 — soxta qattiq kodlangan raqamlar olib tashlandi; real API ko'rsatkichlari.
export default function Dashboard() {
  const { clinicId } = useAuth();
  const today = new Date().toISOString().slice(0, 10);

  const kpisQ = useQuery({
    queryKey: ['m-dash', 'kpis'],
    queryFn: () => staffApi.cashier.kpis(),
    enabled: !!clinicId,
    refetchInterval: 60_000,
  });
  const queueQ = useQuery({
    queryKey: ['m-dash', 'queue-count'],
    queryFn: () => staffApi.queues.count(),
    enabled: !!clinicId,
    refetchInterval: 30_000,
  });
  const apptsQ = useQuery({
    queryKey: ['m-dash', 'appointments', today],
    queryFn: () => staffApi.appointments.list({ from: today, to: today }),
    enabled: !!clinicId,
    refetchInterval: 60_000,
  });

  const loading = kpisQ.isLoading || queueQ.isLoading;
  const error = kpisQ.isError ? kpisQ.error : queueQ.isError ? queueQ.error : null;
  const refetchAll = () => {
    void kpisQ.refetch();
    void queueQ.refetch();
    void apptsQ.refetch();
  };

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={(error as Error)?.message} onRetry={refetchAll} />
      ) : (
        <ScrollView
          className="p-4"
          refreshControl={<RefreshControl refreshing={kpisQ.isFetching} onRefresh={refetchAll} />}
        >
          <Text className="text-2xl font-bold dark:text-white">Boshqaruv paneli</Text>
          <Text className="mt-0.5 text-xs text-gray-500">
            Jonli ko'rsatkichlar — har 30-60 soniyada yangilanadi
          </Text>

          <View className="mt-4 flex-row gap-3">
            <StatCard
              icon="users"
              label="Navbatda"
              value={String(queueQ.data?.count ?? 0)}
            />
            <StatCard
              icon="calendar"
              label="Bugungi qabullar"
              value={String((apptsQ.data ?? []).length)}
            />
          </View>

          <View className="mt-3 flex-row gap-3">
            <StatCard
              icon="trending-up"
              label="Bugungi tushum"
              value={fmtUzs(kpisQ.data?.today_total ?? 0)}
              tone="green"
            />
            <StatCard
              icon="clock"
              label="Ochiq smenalar"
              value={String(kpisQ.data?.open_shifts ?? 0)}
              tone={kpisQ.data?.open_shifts ? 'default' : 'amber'}
            />
          </View>

          <View className="mt-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <Text className="text-xs text-gray-500">Oy tushumi</Text>
            <Text className="mt-1 text-lg font-semibold dark:text-white">
              {fmtUzs(kpisQ.data?.month_revenue ?? 0)}
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
