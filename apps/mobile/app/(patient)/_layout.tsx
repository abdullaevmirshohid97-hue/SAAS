import { Tabs, Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { usePatientAuth } from '../../src/providers/patient-auth-provider';

export default function PatientLayout() {
  const { user, loading } = usePatientAuth();
  if (loading) return null;
  if (!user) return <Redirect href="/(patient-auth)/login" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2563EB', headerShown: false }}>
      <Tabs.Screen name="index"    options={{ title: 'Asosiy', tabBarIcon: ({ color }) => <Feather name="home" color={color} size={20} /> }} />
      <Tabs.Screen name="clinics"  options={{ title: 'Klinikalar', tabBarIcon: ({ color }) => <Feather name="map-pin" color={color} size={20} /> }} />
      <Tabs.Screen name="health"   options={{ title: "Sog'lig'im", tabBarIcon: ({ color }) => <Feather name="heart" color={color} size={20} /> }} />
      <Tabs.Screen name="bookings" options={{ title: 'Navbatlarim', tabBarIcon: ({ color }) => <Feather name="calendar" color={color} size={20} /> }} />
      <Tabs.Screen name="profile"  options={{ title: 'Profil', tabBarIcon: ({ color }) => <Feather name="user" color={color} size={20} /> }} />
      <Tabs.Screen name="clinic/[slug]" options={{ href: null }} />
      <Tabs.Screen name="nurse" options={{ href: null }} />
    </Tabs>
  );
}
