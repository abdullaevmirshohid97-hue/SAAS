import { useState } from 'react';
import {
  View, Text, ScrollView, Modal, TextInput, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../lib/api';

export interface ChatTask {
  id: string;
  requester_name: string;
}

export function ChatModal({ task, onClose }: { task: ChatTask; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const { data } = useQuery({
    queryKey: ['nurse', 'chat', task.id],
    queryFn: () => staffApi.nursePortal.taskMessages(task.id),
    refetchInterval: 5_000,
  });
  const send = useMutation({
    mutationFn: () => staffApi.nursePortal.sendTaskMessage(task.id, { body: text.trim() }),
    onSuccess: () => { setText(''); qc.invalidateQueries({ queryKey: ['nurse', 'chat', task.id] }); },
    onError: (e) => Alert.alert('Xato', (e as Error).message),
  });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-white dark:bg-black" style={{ paddingTop: insets.top + 8 }}>
        <View className="flex-row items-center justify-between border-b border-gray-100 px-4 pb-3 dark:border-gray-800">
          <Text className="text-lg font-semibold dark:text-white">Chat — {task.requester_name}</Text>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={24} color="#6B7280" /></TouchableOpacity>
        </View>
        <ScrollView className="flex-1 p-4" contentContainerStyle={{ gap: 8 }}>
          {(data ?? []).map((m) => (
            <View
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-3 py-2 ${m.sender_kind === 'nurse' ? 'self-end bg-blue-600' : m.sender_kind === 'system' ? 'self-center bg-gray-200 dark:bg-gray-800' : 'self-start bg-gray-100 dark:bg-gray-800'}`}
            >
              <Text className={m.sender_kind === 'nurse' ? 'text-white' : 'text-gray-800 dark:text-gray-100'}>{m.body}</Text>
            </View>
          ))}
          {(data ?? []).length === 0 ? <Text className="mt-8 text-center text-gray-400">Hali xabar yo'q</Text> : null}
        </ScrollView>
        <View className="flex-row items-center gap-2 border-t border-gray-100 p-3 dark:border-gray-800" style={{ paddingBottom: insets.bottom + 8 }}>
          <TextInput
            className="h-11 flex-1 rounded-full border border-gray-300 px-4 dark:border-gray-700 dark:text-white"
            placeholder="Xabar..." placeholderTextColor="#9CA3AF" value={text} onChangeText={setText}
          />
          <TouchableOpacity className="h-11 w-11 items-center justify-center rounded-full bg-blue-600" onPress={() => text.trim() && send.mutate()} disabled={send.isPending}>
            <Feather name="send" size={18} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
