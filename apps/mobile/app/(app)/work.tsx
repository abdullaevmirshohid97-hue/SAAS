import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { EmptyView, ErrorView, LoadingView } from '../../src/components/ui/state-views';

const fmtUzs = (n: number) => `${Math.round(n ?? 0).toLocaleString('uz-UZ')} so'm`;
const fmtDay = (iso: string) =>
  new Date(iso).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short' });

// M3 — xodim "Ish" ekrani: oylik maosh holati, ko'rsatgan xizmatlar ro'yxati,
// statsionar (menga biriktirilgan yotgan bemorlar).
export default function WorkScreen() {
  const { clinicId } = useAuth();

  const salaryQ = useQuery({
    queryKey: ['work', 'salary'],
    queryFn: () => staffApi.payroll.myOverview(),
    enabled: !!clinicId,
  });
  const servicesQ = useQuery({
    queryKey: ['work', 'services'],
    queryFn: () => staffApi.payroll.myServices(),
    enabled: !!clinicId,
  });
  const inpatientsQ = useQuery({
    queryKey: ['work', 'inpatients'],
    queryFn: () => staffApi.staff.myInpatients(),
    enabled: !!clinicId,
    refetchInterval: 60_000,
  });

  const refetchAll = () => {
    void salaryQ.refetch();
    void servicesQ.refetch();
    void inpatientsQ.refetch();
  };

  const loading = salaryQ.isLoading || servicesQ.isLoading;
  const error = salaryQ.isError ? salaryQ.error : servicesQ.isError ? servicesQ.error : null;
  const s = salaryQ.data;
  const monthTotal = (s?.daily ?? []).reduce((a, d) => a + Number(d.amount_uzs ?? 0), 0);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {loading ? (
        <LoadingView />
      ) : error ? (
        <ErrorView message={(error as Error)?.message} onRetry={refetchAll} />
      ) : (
        <ScrollView
          className="p-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={salaryQ.isFetching} onRefresh={refetchAll} />}
        >
          <Text className="text-2xl font-bold dark:text-white">Ish</Text>

          {/* ── Maosh ── */}
          <View className="mt-4 rounded-2xl bg-[#2563EB] p-5">
            <Text className="text-xs text-blue-100">Joriy oy hisoblangan (komissiya)</Text>
            <Text className="mt-1 text-3xl font-bold text-white">{fmtUzs(monthTotal)}</Text>
            <View className="mt-2 flex-row flex-wrap gap-x-4">
              {s?.outstanding?.owed_uzs != null && (
                <Text className="text-xs text-blue-100">
                  Berilishi kerak: {fmtUzs(Number(s.outstanding.owed_uzs))}
                </Text>
              )}
              {s?.last_payout && (
                <Text className="text-xs text-blue-100">
                  Oxirgi to'lov: {fmtUzs(Number(s.last_payout.net_uzs))}
                  {s.last_payout.paid_at ? ` (${fmtDay(s.last_payout.paid_at)})` : ''}
                </Text>
              )}
            </View>
          </View>

          {/* ── Statsionar bemorlarim ── */}
          <View className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <View className="mb-2 flex-row items-center gap-2">
              <Feather name="home" size={14} color="#6B7280" />
              <Text className="text-xs font-semibold uppercase text-gray-500">
                Statsionar bemorlarim ({(inpatientsQ.data ?? []).length})
              </Text>
            </View>
            {(inpatientsQ.data ?? []).length === 0 ? (
              <Text className="text-sm text-gray-500">Hozircha yotgan bemor yo'q</Text>
            ) : (
              (inpatientsQ.data ?? []).map((st) => (
                <View key={st.id} className="border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800">
                  <Text className="font-medium dark:text-white" numberOfLines={1}>
                    {st.patient?.full_name?.trim() || 'Bemor'}
                  </Text>
                  <Text className="text-xs text-gray-500">
                    {st.room
                      ? `Xona ${st.room.number}${st.room.floor != null ? ` · ${st.room.floor}-qavat` : ''}`
                      : 'Xona —'}
                    {' · '}
                    {fmtDay(st.admitted_at)} dan beri
                  </Text>
                </View>
              ))
            )}
          </View>

          {/* ── Ko'rsatgan xizmatlarim ── */}
          <View className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <View className="mb-2 flex-row items-center justify-between">
              <View className="flex-row items-center gap-2">
                <Feather name="briefcase" size={14} color="#6B7280" />
                <Text className="text-xs font-semibold uppercase text-gray-500">
                  Xizmatlarim (30 kun)
                </Text>
              </View>
              <Text className="text-xs font-semibold text-emerald-600">
                {fmtUzs(servicesQ.data?.total_commission_uzs ?? 0)}
              </Text>
            </View>
            {(servicesQ.data?.rows ?? []).length === 0 ? (
              <EmptyView icon="briefcase" title="Xizmatlar yo'q" subtitle="Oxirgi 30 kunda komissiya yozuvi topilmadi" />
            ) : (
              (servicesQ.data?.rows ?? []).slice(0, 50).map((r) => (
                <View key={r.id} className="border-t border-gray-100 py-2 first:border-t-0 dark:border-gray-800">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 pr-2 text-sm dark:text-white" numberOfLines={1}>
                      {r.services.map((x) => x.name).join(', ') || 'Xizmat'}
                    </Text>
                    <Text className="text-sm font-semibold text-emerald-600">
                      +{fmtUzs(r.commission_uzs)}
                    </Text>
                  </View>
                  <Text className="text-[11px] text-gray-500">{fmtDay(r.created_at)}</Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
