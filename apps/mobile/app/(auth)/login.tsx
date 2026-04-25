import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';

import { supabase } from '../../src/lib/supabase';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn() {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) Alert.alert('Xato', error.message);
    else router.replace('/(app)/');
  }

  return (
    <View className="flex-1 justify-center bg-white px-6 dark:bg-black">
      <Text className="text-3xl font-bold dark:text-white">Clary</Text>
      <Text className="mt-1 text-gray-500">Klinika boshqaruvi</Text>

      <View className="mt-8 gap-3">
        <TextInput
          className="h-12 rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
          placeholder="Email"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          className="h-12 rounded-lg border border-gray-300 px-3 dark:border-gray-700 dark:text-white"
          placeholder="Parol"
          placeholderTextColor="#9CA3AF"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        <TouchableOpacity
          className="mt-2 h-12 items-center justify-center rounded-lg bg-blue-600"
          onPress={signIn}
          disabled={loading}
        >
          <Text className="font-semibold text-white">{loading ? '\u2026' : 'Kirish'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
