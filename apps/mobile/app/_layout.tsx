import 'react-native-url-polyfill/auto';
import { Stack } from 'expo-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import '../global.css';
import { AuthProvider } from '../src/providers/auth-provider';
import { PatientAuthProvider } from '../src/providers/patient-auth-provider';

SplashScreen.preventAutoHideAsync();

const qc = new QueryClient();

export default function RootLayout() {
  useEffect(() => { SplashScreen.hideAsync(); }, []);
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
