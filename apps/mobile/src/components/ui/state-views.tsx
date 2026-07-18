import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

/**
 * C1 — ekranlar uchun yagona yuklanish/xato/bo'sh holatlar.
 * Tarmoq uzilsa foydalanuvchi jim bo'sh ekran emas, aniq xabar ko'radi.
 */
export function LoadingView({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <ActivityIndicator size="large" color="#2563EB" />
      <Text className="text-sm text-gray-500">{label}</Text>
    </View>
  );
}

export function ErrorView({
  message,
  onRetry,
}: {
  message?: string | null;
  onRetry?: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-3 p-8">
      <Feather name="wifi-off" size={28} color="#DC2626" />
      <Text className="text-center text-sm text-red-600">
        Yuklashda xatolik{message ? `: ${message}` : ''}
      </Text>
      {onRetry && (
        <TouchableOpacity
          onPress={onRetry}
          className="rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-700"
        >
          <Text className="text-sm font-medium dark:text-white">Qayta urinish</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export function EmptyView({
  icon = 'inbox',
  title,
  subtitle,
}: {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="flex-1 items-center justify-center gap-2 p-8">
      <Feather name={icon} size={28} color="#9CA3AF" />
      <Text className="text-base font-medium dark:text-white">{title}</Text>
      {subtitle && <Text className="text-center text-xs text-gray-500">{subtitle}</Text>}
    </View>
  );
}
