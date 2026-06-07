import { Tabs, Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useAuth } from '../../src/providers/auth-provider';

export default function NurseLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2563EB', headerShown: false }}>
      <Tabs.Screen name="index"   options={{ title: 'Bosh sahifa', tabBarIcon: ({ color }) => <Feather name="home" color={color} size={20} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profil',      tabBarIcon: ({ color }) => <Feather name="user" color={color} size={20} /> }} />
    </Tabs>
  );
}
