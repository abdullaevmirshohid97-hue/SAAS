import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';

import { staffApi } from '../../src/lib/api';
import { useAuth } from '../../src/providers/auth-provider';
import { ErrorView, LoadingView } from '../../src/components/ui/state-views';

const fmtUzs = (n: number) => `${Math.round(n ?? 0).toLocaleString('uz-UZ')} so'm`;

const METHOD_LABELS: Record<string, string> = {
  cash: 'Naqd',
  card: 'Karta',
  transfer: "O'tkazma",
  click: 'Click',
  payme: 'Payme',
  mixed: 'Aralash',
  insurance: "Sug'urta",
};

// C5 — "Phase 5 full" placeholder edi; endi read-only kassa ko'rinishi:
// bugungi tushum, to'lov kanallari, ochiq smena, TOP qarzdorlar.
export default function CashierScreen() {
  const { clinicId } = useAuth();

  const kpisQ = useQuery({
    queryKey: ['m-cashier', 'kpis'],
    queryFn: () => staffApi.cashier.kpis(),
    enabled: !!clinicId,
    refetchInterval: 60_000,
  });
  const debtorsQ = useQuery({
    queryKey: ['m-cashier', 'debtors'],
    queryFn: () => staffApi.cashier.topDebtors(5),
    enabled: !!clinicId,
    refetchInterval: 120_000,
  });

  const k = kpisQ.data;
  const byMethod = Object.entries(k?.by_payment_method_today_total ?? {}).filter(([, v]) => v > 0);

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {kpisQ.isLoading ? (
        <LoadingView />
      ) : kpisQ.isError ? (
        <ErrorView message={(kpisQ.error as Error)?.message} onRetry={() => void kpisQ.refetch()} />
      ) : (
        <ScrollView
          className="p-4"
          refreshControl={
            <RefreshControl
              refreshing={kpisQ.isFetching}
              onRefresh={() => {
                void kpisQ.refetch();
                void debtorsQ.refetch();
              }}
            />
          }
        >
          <Text className="text-2xl font-bold dark:text-white">Kassa</Text>
          <Text className="mt-0.5 text-xs text-gray-500">
            Ko'rish rejimi — to'lov qabul qilish web/desktop kassada
          </Text>

          <View className="mt-4 rounded-2xl bg-[#2563EB] p-5">
            <Text className="text-xs text-blue-100">Bugungi tushum</Text>
            <Text className="mt-1 text-3xl font-bold text-white">{fmtUzs(k?.today_total ?? 0)}</Text>
            <Text className="mt-1 text-xs text-blue-100">
              Kecha: {fmtUzs(k?.yesterday_total ?? 0)} · Ochiq smena: {k?.open_shifts ?? 0}
            </Text>
          </View>

          {byMethod.length > 0 && (
            <View className="mt-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Text className="mb-2 text-xs font-semibold uppercase text-gray-500">
                Bugun to'lov kanallari
              </Text>
              {byMethod.map(([method, amount]) => (
                <View key={method} className="flex-row items-center justify-between py-1">
                  <Text className="text-sm dark:text-white">{METHOD_LABELS[method] ?? method}</Text>
                  <Text className="text-sm font-semibold dark:text-white">{fmtUzs(amount)}</Text>
                </View>
              ))}
            </View>
          )}

          <View className="mt-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <Text className="mb-2 text-xs font-semibold uppercase text-gray-500">
              TOP qarzdor bemorlar
            </Text>
            {(debtorsQ.data ?? []).length === 0 ? (
              <Text className="text-sm text-gray-500">Qarzdorlar yo'q ✓</Text>
            ) : (
              (debtorsQ.data ?? []).map((d) => (
                <View key={d.patient_id} className="flex-row items-center justify-between py-1">
                  <Text className="flex-1 pr-2 text-sm dark:text-white" numberOfLines={1}>
                    {d.full_name?.trim() || 'Nomsiz bemor'}
                  </Text>
                  <Text className="text-sm font-semibold text-rose-600">{fmtUzs(d.debt_uzs)}</Text>
                </View>
              ))
            )}
          </View>

          <View className="mt-3 flex-row gap-3">
            <View className="flex-1 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Text className="text-xs text-gray-500">Oy tushumi</Text>
              <Text className="mt-1 text-base font-semibold dark:text-white">
                {fmtUzs(k?.month_revenue ?? 0)}
              </Text>
            </View>
            <View className="flex-1 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
              <Text className="text-xs text-gray-500">Oy foydasi</Text>
              <Text className="mt-1 text-base font-semibold dark:text-white">
                {fmtUzs(k?.month_profit ?? 0)}
              </Text>
            </View>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
