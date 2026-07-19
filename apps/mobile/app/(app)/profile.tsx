import { useState } from 'react';
import { Alert, Image, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { decode } from 'base64-arraybuffer';
import { Feather } from '@expo/vector-icons';

import { staffApi } from '../../src/lib/api';
import { supabase } from '../../src/lib/supabase';
import { useAuth } from '../../src/providers/auth-provider';
import { LanguagePicker } from '../../src/components/ui/language-picker';
import { ErrorView, LoadingView } from '../../src/components/ui/state-views';

// M2 — xodim o'z profili: rasm yuklash (admin anketasida ham ko'rinadi),
// ism/telefon tahriri, til tanlash, chiqish.
export default function StaffProfileScreen() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const meQ = useQuery({
    queryKey: ['staff-me'],
    queryFn: () => staffApi.staff.me(),
    enabled: !!session,
  });

  const saveMut = useMutation({
    mutationFn: (body: { full_name?: string; phone?: string | null; photo_url?: string | null }) =>
      staffApi.staff.updateMe(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['staff-me'] });
      Alert.alert('Saqlandi', 'Profil yangilandi');
    },
    onError: (e: Error) => Alert.alert('Xatolik', e.message),
  });

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Ruxsat kerak', "Galereyaga ruxsat bermasangiz rasm tanlab bo'lmaydi");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: true,
    });
    const asset = res.assets?.[0];
    if (res.canceled || !asset?.base64) return;

    setUploading(true);
    try {
      const path = `staff/${session?.user?.id ?? 'x'}/${Date.now()}.jpg`;
      const { error } = await supabase.storage
        .from('avatars')
        .upload(path, decode(asset.base64), { contentType: 'image/jpeg', upsert: true });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      saveMut.mutate({ photo_url: data.publicUrl });
    } catch (e) {
      Alert.alert('Yuklanmadi', (e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const me = meQ.data;
  const displayName = name ?? me?.full_name ?? '';
  const displayPhone = phone ?? me?.phone ?? '';
  const dirty =
    (name !== null && name !== me?.full_name) || (phone !== null && phone !== (me?.phone ?? ''));

  return (
    <SafeAreaView className="flex-1 bg-white dark:bg-black">
      {meQ.isLoading ? (
        <LoadingView />
      ) : meQ.isError ? (
        <ErrorView message={(meQ.error as Error)?.message} onRetry={() => void meQ.refetch()} />
      ) : (
        <ScrollView className="p-4" contentContainerStyle={{ paddingBottom: 32 }}>
          <Text className="text-2xl font-bold dark:text-white">Profil</Text>

          {/* Rasm */}
          <View className="mt-5 items-center">
            <TouchableOpacity onPress={() => void pickPhoto()} disabled={uploading}>
              {me?.photo_url ? (
                <Image
                  source={{ uri: me.photo_url }}
                  className="h-24 w-24 rounded-full border-2 border-[#2563EB]"
                />
              ) : (
                <View className="h-24 w-24 items-center justify-center rounded-full bg-blue-100">
                  <Feather name="user" size={40} color="#2563EB" />
                </View>
              )}
              <View className="absolute -bottom-1 -right-1 h-8 w-8 items-center justify-center rounded-full bg-[#2563EB]">
                <Feather name={uploading ? 'loader' : 'camera'} size={14} color="white" />
              </View>
            </TouchableOpacity>
            <Text className="mt-2 text-xs text-gray-500">
              {uploading ? 'Yuklanmoqda…' : 'Rasmni almashtirish uchun bosing'}
            </Text>
            <Text className="mt-2 text-base font-semibold dark:text-white">{me?.email}</Text>
            <Text className="text-xs text-gray-500">{me?.hr?.position ?? me?.role}</Text>
          </View>

          {/* Tahrir maydonlari */}
          <View className="mt-6 gap-3">
            <View>
              <Text className="mb-1 text-xs text-gray-500">To'liq ism</Text>
              <TextInput
                className="h-11 rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
                value={displayName}
                onChangeText={setName}
              />
            </View>
            <View>
              <Text className="mb-1 text-xs text-gray-500">Telefon</Text>
              <TextInput
                className="h-11 rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
                value={displayPhone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                placeholder="+998..."
                placeholderTextColor="#9CA3AF"
              />
            </View>
            {dirty && (
              <TouchableOpacity
                disabled={saveMut.isPending}
                onPress={() =>
                  saveMut.mutate({
                    ...(name !== null ? { full_name: name } : {}),
                    ...(phone !== null ? { phone } : {}),
                  })
                }
                className="h-11 items-center justify-center rounded-lg bg-[#2563EB]"
              >
                <Text className="font-semibold text-white">
                  {saveMut.isPending ? 'Saqlanmoqda…' : 'Saqlash'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Til */}
          <View className="mt-6">
            <LanguagePicker />
          </View>

          {/* Chiqish */}
          <TouchableOpacity
            className="mt-6 flex-row items-center justify-center gap-2 rounded-xl border border-red-200 py-3 dark:border-red-900"
            onPress={() =>
              Alert.alert('Chiqish', 'Akkauntdan chiqmoqchimisiz?', [
                { text: 'Bekor', style: 'cancel' },
                {
                  text: 'Chiqish',
                  style: 'destructive',
                  onPress: () => void supabase.auth.signOut(),
                },
              ])
            }
          >
            <Feather name="log-out" size={18} color="#DC2626" />
            <Text className="font-semibold text-red-600">Chiqish</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
