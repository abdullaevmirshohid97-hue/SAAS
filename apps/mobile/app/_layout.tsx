import 'react-native-url-polyfill/auto';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthProvider } from '../src/providers/auth-provider';
import { PatientAuthProvider } from '../src/providers/patient-auth-provider';
import { initMobileI18n } from '../src/lib/i18n';

SplashScreen.preventAutoHideAsync();

const qc = new QueryClient();

export default function RootLayout() {
  // C6 — i18n tayyor bo'lguncha splash ushlab turiladi (saqlangan til yuklanadi).
  const [i18nReady, setI18nReady] = useState(false);
  useEffect(() => {
    void initMobileI18n().finally(() => setI18nReady(true));
  }, []);
  useEffect(() => {
    if (i18nReady) void SplashScreen.hideAsync();
  }, [i18nReady]);
  if (!i18nReady) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <PatientAuthProvider>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="(auth)" />
              <Stack.Screen name="(app)" />
              <Stack.Screen name="(nurse)" />
              <Stack.Screen name="(patient-auth)" />
              <Stack.Screen name="(patient)" />
            </Stack>
          </PatientAuthProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
