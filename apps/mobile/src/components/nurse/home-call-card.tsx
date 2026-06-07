import { View, Text, TouchableOpacity, Linking, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../lib/api';
import { homeStatus } from './task-labels';

export type HomeCall = Awaited<ReturnType<typeof staffApi.nursePortal.tasks>>[number];

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export function HomeCallCard({
  item,
  onStart,
  onComplete,
  onChat,
  busy,
}: {
  item: HomeCall;
  onStart: (id: string) => void;
  onComplete: (id: string) => void;
  onChat: (item: HomeCall) => void;
  busy?: boolean;
}) {
  const st = homeStatus(item.status);
  return (
    <View className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-2">
          <Text className="text-base font-semibold dark:text-white">{item.service}</Text>
          {item.is_urgent ? (
            <View className="rounded bg-red-100 px-1.5 py-0.5">
              <Text className="text-[10px] font-semibold text-red-600">Shoshilinch</Text>
            </View>
          ) : null}
        </View>
        <View className={`rounded-full px-2 py-0.5 ${st.cls.split(' ')[0]}`}>
          <Text className={`text-xs font-medium ${st.cls.split(' ')[1]}`}>{st.label}</Text>
        </View>
      </View>

      <View className="mt-2 flex-row items-center gap-1">
        <Feather name="user" size={13} color="#9CA3AF" />
        <Text className="text-sm text-gray-700 dark:text-gray-200">{item.requester_name}</Text>
        <TouchableOpacity onPress={() => Linking.openURL(`tel:${item.requester_phone}`)} className="ml-1">
          <Text className="text-sm text-blue-600">{item.requester_phone}</Text>
        </TouchableOpacity>
      </View>
      <View className="mt-1 flex-row items-start gap-1">
        <Feather name="map-pin" size={13} color="#9CA3AF" style={{ marginTop: 2 }} />
        <Text className="flex-1 text-sm text-gray-600 dark:text-gray-300">{item.address}</Text>
      </View>
      {item.geo_lat != null && item.geo_lng != null ? (
        <TouchableOpacity
          className="mt-2 flex-row items-center gap-1 self-start rounded-lg bg-blue-50 px-3 py-1.5 dark:bg-blue-950"
          onPress={() => Linking.openURL(mapsUrl(item.geo_lat as number, item.geo_lng as number))}
        >
          <Feather name="navigation" size={14} color="#2563EB" />
          <Text className="text-sm font-semibold text-blue-700">Xaritada ochish</Text>
        </TouchableOpacity>
      ) : null}
      {item.notes ? <Text className="mt-2 text-sm text-gray-500 dark:text-gray-400">📝 {item.notes}</Text> : null}

      <View className="mt-3 flex-row gap-2">
        {item.status === 'assigned' && (
          <TouchableOpacity className="rounded-lg bg-indigo-600 px-3 py-2" onPress={() => onStart(item.id)} disabled={busy}>
            <Text className="text-sm font-semibold text-white">Yo'lga chiqdim</Text>
          </TouchableOpacity>
        )}
        {['on_the_way', 'in_progress'].includes(item.status) && (
          <TouchableOpacity
            className="rounded-lg bg-emerald-600 px-3 py-2"
            onPress={() =>
              Alert.alert('Tugatish', 'Vazifani yakunlaysizmi?', [
                { text: "Yo'q", style: 'cancel' },
                { text: 'Ha', onPress: () => onComplete(item.id) },
              ])
            }
            disabled={busy}
          >
            <Text className="text-sm font-semibold text-white">Tugatish</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          className="flex-row items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-700"
          onPress={() => onChat(item)}
        >
          <Feather name="message-circle" size={14} color="#6B7280" />
          <Text className="text-sm text-gray-600 dark:text-gray-300">Chat</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
