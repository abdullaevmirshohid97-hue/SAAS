import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { usePatientAuth } from '../../src/providers/patient-auth-provider';

export default function PatientLogin() {
  const router = useRouter();
  const { requestOtp, verifyOtp } = usePatientAuth();

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sendCode() {
    if (phone.replace(/\D/g, '').length < 9) {
      Alert.alert('Xato', 'Telefon raqamni to\'liq kiriting');
      return;
    }
    setLoading(true);
    try {
      const res = await requestOtp(phone);
      setDevCode(res.dev_code ?? null);
      if (res.dev_code) setCode(res.dev_code); // DEV: kodni avtomatik to'ldiramiz
      setStep('code');
    } catch (e) {
      Alert.alert('Xato', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function confirmCode() {
    setLoading(true);
    try {
      await verifyOtp(phone, code);
      router.replace('/(patient)/');
    } catch (e) {
      Alert.alert('Xato', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View className="flex-1 justify-center bg-white px-6 dark:bg-black">
      <TouchableOpacity className="absolute left-4 top-14" onPress={() => router.back()}>
        <Feather name="arrow-left" size={24} color="#6B7280" />
      </TouchableOpacity>

      <Text className="text-3xl font-bold text-blue-600">Clary</Text>
      <Text className="mt-1 text-gray-500 dark:text-gray-400">
        {step === 'phone' ? 'Telefon raqamingizni kiriting' : 'SMS kodni kiriting'}
      </Text>

      {step === 'phone' ? (
        <View className="mt-8 gap-3">
          <TextInput
            className="h-12 rounded-lg border border-gray-300 px-3 text-base dark:border-gray-700 dark:text-white"
            placeholder="+998 90 123 45 67"
            placeholderTextColor="#9CA3AF"
            keyboardType="phone-pad"
            value={phone}
            onChangeText={setPhone}
            autoFocus
          />
          <TouchableOpacity
            className="mt-2 h-12 items-center justify-center rounded-lg bg-blue-600"
            onPress={sendCode}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text className="font-semibold text-white">Kod yuborish</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <View className="mt-8 gap-3">
          {devCode && (
            <Text className="rounded-lg bg-amber-100 px-3 py-2 text-amber-800">
              DEV rejim — kod: {devCode}
            </Text>
          )}
          <TextInput
            className="h-12 rounded-lg border border-gray-300 px-3 text-center text-2xl tracking-[8px] dark:border-gray-700 dark:text-white"
            placeholder="••••••"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            maxLength={6}
            value={code}
            onChangeText={setCode}
            autoFocus
          />
          <TouchableOpacity
            className="mt-2 h-12 items-center justify-center rounded-lg bg-blue-600"
            onPress={confirmCode}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text className="font-semibold text-white">Tasdiqlash</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStep('phone')}>
            <Text className="mt-2 text-center text-blue-600">Raqamni o'zgartirish</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
