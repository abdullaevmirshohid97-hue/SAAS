import { View, Text, TouchableOpacity, Linking, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../lib/api';
import { clinicCategory, clinicStatus, isUrgentPriority, timeLabel } from './task-labels';

export type ClinicTask = Awaited<ReturnType<typeof staffApi.nurse.listTasks>>[number];

export function ClinicTaskCard({
  task,
  variant,
  onStart,
  onComplete,
  onClaim,
  busy,
}: {
  task: ClinicTask;
  variant: 'mine' | 'claimable';
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onClaim: (id: string) => void;
  busy?: boolean;
}) {
  const cat = clinicCategory(task.category);
  const st = clinicStatus(task.status);
  const urgent = isUrgentPriority(task.priority);
  const due = timeLabel(task.due_at);

  return (
    <View className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-2">
          <Feather name={cat.icon as keyof typeof Feather.glyphMap} size={15} color="#2563EB" />
          <Text className="flex-1 text-base font-semibold dark:text-white" numberOfLines={1}>
            {task.title}
          </Text>
          {urgent ? (
            <View className="rounded bg-red-100 px-1.5 py-0.5">
              <Text className="text-[10px] font-semibold text-red-600">Shoshilinch</Text>
            </View>
          ) : null}
        </View>
        {variant === 'mine' ? (
          <View className={`ml-2 rounded-full px-2 py-0.5 ${st.cls.split(' ')[0]}`}>
            <Text className={`text-xs font-medium ${st.cls.split(' ')[1]}`}>{st.label}</Text>
          </View>
        ) : null}
      </View>

      <View className="mt-1.5 flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <View className="flex-row items-center gap-1">
          <Feather name="tag" size={12} color="#9CA3AF" />
          <Text className="text-xs text-gray-500 dark:text-gray-400">{cat.label}</Text>
        </View>
        {due ? (
          <View className="flex-row items-center gap-1">
            <Feather name="clock" size={12} color="#9CA3AF" />
            <Text className="text-xs text-gray-500 dark:text-gray-400">{due}</Text>
          </View>
        ) : null}
      </View>

      {task.patient ? (
        <View className="mt-2 flex-row items-center gap-1">
          <Feather name="user" size={13} color="#9CA3AF" />
          <Text className="text-sm text-gray-700 dark:text-gray-200">{task.patient.full_name}</Text>
          {task.patient.phone ? (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${task.patient!.phone}`)} className="ml-1">
              <Text className="text-sm text-blue-600">{task.patient.phone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {task.notes ? (
        <Text className="mt-2 text-sm text-gray-500 dark:text-gray-400">📝 {task.notes}</Text>
      ) : null}

      <View className="mt-3 flex-row gap-2">
        {variant === 'claimable' ? (
          <TouchableOpacity
            className="flex-row items-center gap-1 rounded-lg bg-blue-600 px-3 py-2"
            onPress={() => onClaim(task.id)}
            disabled={busy}
          >
            <Feather name="plus" size={14} color="white" />
            <Text className="text-sm font-semibold text-white">Qabul qilish</Text>
          </TouchableOpacity>
        ) : (
          <>
            {task.status === 'pending' && (
              <TouchableOpacity
                className="rounded-lg bg-indigo-600 px-3 py-2"
                onPress={() => onStart(task.id)}
                disabled={busy}
              >
                <Text className="text-sm font-semibold text-white">Boshlash</Text>
              </TouchableOpacity>
            )}
            {task.status === 'in_progress' && (
              <TouchableOpacity
                className="rounded-lg bg-emerald-600 px-3 py-2"
                onPress={() =>
                  Alert.alert('Bajardim', 'Vazifani bajarilgan deb belgilaysizmi?', [
                    { text: "Yo'q", style: 'cancel' },
                    { text: 'Ha', onPress: () => onComplete(task.id) },
                  ])
                }
                disabled={busy}
              >
                <Text className="text-sm font-semibold text-white">Bajardim</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </View>
  );
}
