import { useState } from 'react';
import { View, Text, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Switch, Alert, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';

import { patientApi } from '../../src/lib/api';
import { usePatientAuth } from '../../src/providers/patient-auth-provider';

function mapsUrl(lat: number, lng: number) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

interface Clinic { id: string; name: string; slug: string }

const SERVICES = ['In\'eksiya (ukol)', 'Tomchi (sistema)', 'Bosim o\'lchash', 'Qon olish', 'Bog\'lov', 'Kateter', 'Boshqa'];

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Kutilmoqda', cls: 'bg-amber-100 text-amber-700' },
  accepted: { label: 'Qabul qilindi', cls: 'bg-green-100 text-green-700' },
  assigned: { label: 'Hamshira biriktirildi', cls: 'bg-blue-100 text-blue-700' },
  completed: { label: 'Yakunlandi', cls: 'bg-blue-100 text-blue-700' },
  canceled: { label: 'Bekor', cls: 'bg-gray-200 text-gray-600' },
};

export default function NurseScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = usePatientAuth();

  const [clinicId, setClinicId] = useState<string | null>(null);
  const [service, setService] = useState<string>(SERVICES[0]);
  const [name, setName] = useState(user?.full_name && !user.full_name.startsWith('+') ? user.full_name : '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [address, setAddress] = useState('');
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);

  async function shareLocation() {
    setLocating(true);
    try {
      // Lazy require — native modul asosiy bundle'da, lekin faqat shu yerda (bridge
      // tayyor bo'lganda) bajariladi. Top-level import startda SIGSEGV berardi.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Location = require('expo-location') as typeof import('expo-location');
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Ruxsat kerak', 'Joylashuvni ulashish uchun ruxsat bering');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setGeo({ lat, lng });
      // Manzil bo'sh bo'lsa — teskari geokodlash bilan to'ldiramiz
      if (!address.trim()) {
        try {
          const places = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
          const p = places[0];
          if (p) {
            const formatted = [p.city ?? p.subregion, p.district ?? p.street, p.name]
              .filter(Boolean)
              .join(', ');
            if (formatted.length >= 5) setAddress(formatted);
          }
        } catch {
          /* reverse geocode ixtiyoriy */
        }
      }
    } catch (e) {
      Alert.alert('Xato', 'Joylashuvni olishda xatolik: ' + (e as Error).message);
    } finally {
      setLocating(false);
    }
  }

  const { data: clinicsResp } = useQuery({
    queryKey: ['patient', 'clinics', ''],
    queryFn: () => patientApi.patient.searchClinics(),
  });
  const clinics = ((clinicsResp as { data?: Clinic[] } | undefined)?.data ?? []) as Clinic[];

  const { data: requests, isLoading: reqLoading } = useQuery({
    queryKey: ['patient', 'nurse-requests'],
    queryFn: () => patientApi.patient.listMyNurseRequests(),
  });

  const mutation = useMutation({
    mutationFn: () =>
      patientApi.patient.createNurseRequest({
        clinic_id: clinicId!,
        service,
        requester_name: name.trim(),
        requester_phone: phone.trim(),
        address: address.trim(),
        geo_lat: geo?.lat,
        geo_lng: geo?.lng,
        is_urgent: urgent,
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['patient', 'nurse-requests'] });
      setAddress(''); setNotes(''); setUrgent(false); setGeo(null);
      Alert.alert('Yuborildi', 'Hamshira chaqirish so\'rovingiz yuborildi. Klinika tez orada bog\'lanadi.');
    },
    onError: (e) => Alert.alert('Xato', (e as Error).message),
  });

  function submit() {
    if (!clinicId) return Alert.alert('Xato', 'Klinikani tanlang');
    if (name.trim().length < 2) return Alert.alert('Xato', 'Ismingizni kiriting');
    if (phone.replace(/\D/g, '').length < 9) return Alert.alert('Xato', 'Telefon raqamni kiriting');
    if (address.trim().length < 5) return Alert.alert('Xato', 'Manzilni to\'liq kiriting');
    mutation.mutate();
  }

  return (
    <View className="flex-1 bg-white dark:bg-black">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, padding: 16, paddingBottom: 40 }}>
        <TouchableOpacity className="mb-2" onPress={() => router.back()}>
          <Feather name="arrow-left" size={24} color="#6B7280" />
        </TouchableOpacity>
        <Text className="text-2xl font-bold dark:text-white">Hamshira chaqirish</Text>
        <Text className="mt-1 text-sm text-gray-500 dark:text-gray-400">Uyga hamshira xizmati so'rovi</Text>

        {/* Klinika */}
        <Text className="mt-5 text-sm font-medium text-gray-600 dark:text-gray-300">Klinika</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {clinics.map((c) => (
            <Chip key={c.id} label={c.name} active={clinicId === c.id} onPress={() => setClinicId(c.id)} />
          ))}
          {clinics.length === 0 ? <Text className="text-sm text-gray-400">Klinikalar yuklanmoqda...</Text> : null}
        </View>

        {/* Xizmat */}
        <Text className="mt-5 text-sm font-medium text-gray-600 dark:text-gray-300">Xizmat turi</Text>
        <View className="mt-2 flex-row flex-wrap gap-2">
          {SERVICES.map((s) => (
            <Chip key={s} label={s} active={service === s} onPress={() => setService(s)} />
          ))}
        </View>

        {/* Ism / telefon */}
        <Text className="mt-5 text-sm font-medium text-gray-600 dark:text-gray-300">Ism</Text>
        <TextInput
          className="mt-2 h-12 rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
          placeholder="Ismingiz" placeholderTextColor="#9CA3AF" value={name} onChangeText={setName}
        />
        <Text className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300">Telefon</Text>
        <TextInput
          className="mt-2 h-12 rounded-xl border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
          placeholder="+998..." placeholderTextColor="#9CA3AF" keyboardType="phone-pad" value={phone} onChangeText={setPhone}
        />

        {/* Manzil */}
        <Text className="mt-3 text-sm font-medium text-gray-600 dark:text-gray-300">Manzil</Text>
        <TextInput
          className="mt-2 min-h-[60px] rounded-xl border border-gray-300 p-3 dark:border-gray-700 dark:text-white"
          placeholder="Tuman, ko'cha, uy..." placeholderTextColor="#9CA3AF" multiline value={address} onChangeText={setAddress} textAlignVertical="top"
        />

        {/* Lokatsiya — bir bosishda GPS (hamshira adashmasdan kelishi uchun) */}
        {geo ? (
          <View className="mt-3 flex-row items-center justify-between rounded-xl border border-green-200 bg-green-50 px-3 py-3 dark:border-green-900 dark:bg-green-950">
            <View className="flex-1 flex-row items-center gap-2">
              <Feather name="check-circle" size={18} color="#16A34A" />
              <View className="flex-1">
                <Text className="text-sm font-medium text-green-700">Lokatsiya ulashildi</Text>
                <Text className="text-xs text-green-600" numberOfLines={1}>
                  {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
                </Text>
              </View>
            </View>
            <TouchableOpacity className="mr-2" onPress={() => Linking.openURL(mapsUrl(geo.lat, geo.lng))}>
              <Text className="text-sm font-medium text-blue-600">Xaritada</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setGeo(null)}>
              <Feather name="x" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            className="mt-3 flex-row items-center justify-center gap-2 rounded-xl border border-blue-300 bg-blue-50 py-3 dark:border-blue-900 dark:bg-blue-950"
            onPress={shareLocation}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator color="#2563EB" />
            ) : (
              <>
                <Feather name="map-pin" size={18} color="#2563EB" />
                <Text className="font-semibold text-blue-700">Lokatsiyani ulashish (1 bosishda)</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        <Text className="mt-1 text-xs text-gray-400">Hamshira sizni adashmasdan topishi uchun</Text>

        {/* Shoshilinch */}
        <View className="mt-4 flex-row items-center justify-between rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
          <View className="flex-row items-center gap-2">
            <Feather name="zap" size={16} color="#F59E0B" />
            <Text className="dark:text-gray-200">Shoshilinch</Text>
          </View>
          <Switch value={urgent} onValueChange={setUrgent} trackColor={{ true: '#2563EB' }} />
        </View>

        {/* Izoh */}
        <TextInput
          className="mt-3 min-h-[60px] rounded-xl border border-gray-300 p-3 dark:border-gray-700 dark:text-white"
          placeholder="Qo'shimcha izoh (ixtiyoriy)" placeholderTextColor="#9CA3AF" multiline value={notes} onChangeText={setNotes} textAlignVertical="top"
        />

        <TouchableOpacity className="mt-5 h-12 items-center justify-center rounded-xl bg-blue-600" onPress={submit} disabled={mutation.isPending}>
          {mutation.isPending ? <ActivityIndicator color="white" /> : <Text className="text-base font-semibold text-white">So'rov yuborish</Text>}
        </TouchableOpacity>

        {/* Mening so'rovlarim */}
        <Text className="mt-8 text-lg font-semibold dark:text-white">Mening so'rovlarim</Text>
        {reqLoading ? (
          <ActivityIndicator className="mt-4" color="#2563EB" />
        ) : (requests ?? []).length === 0 ? (
          <Text className="mt-2 text-sm text-gray-400">Hozircha so'rov yo'q</Text>
        ) : (
          <View className="mt-2 gap-2">
            {(requests ?? []).map((r) => {
              const st = STATUS[r.status] ?? { label: r.status, cls: 'bg-gray-100 text-gray-600' };
              const price = r.quoted_price_uzs ?? r.estimate_total_uzs;
              return (
                <View key={r.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900">
                  <View className="flex-row items-center justify-between">
                    <Text className="flex-1 font-medium dark:text-white">{r.service}</Text>
                    <View className={`rounded-full px-2 py-0.5 ${st.cls.split(' ')[0]}`}>
                      <Text className={`text-xs font-medium ${st.cls.split(' ')[1]}`}>{st.label}</Text>
                    </View>
                  </View>
                  <Text className="mt-1 text-xs text-gray-500 dark:text-gray-400">{r.address}</Text>
                  {r.geo_lat != null && r.geo_lng != null ? (
                    <TouchableOpacity
                      className="mt-1 flex-row items-center gap-1"
                      onPress={() => Linking.openURL(mapsUrl(r.geo_lat as number, r.geo_lng as number))}
                    >
                      <Feather name="map-pin" size={12} color="#2563EB" />
                      <Text className="text-xs font-medium text-blue-600">Xaritada ko'rish</Text>
                    </TouchableOpacity>
                  ) : null}
                  {r.is_urgent ? <Text className="mt-1 text-xs font-medium text-amber-600">Shoshilinch</Text> : null}
                  {price ? <Text className="mt-1 text-sm font-semibold text-green-700">{price.toLocaleString('uz-UZ')} so'm</Text> : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} className={`rounded-full border px-4 py-2 ${active ? 'border-blue-600 bg-blue-600' : 'border-gray-300 dark:border-gray-700'}`}>
      <Text className={`text-sm ${active ? 'font-semibold text-white' : 'text-gray-700 dark:text-gray-300'}`}>{label}</Text>
    </TouchableOpacity>
  );
}
