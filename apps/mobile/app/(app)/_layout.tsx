import { Tabs, Redirect } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { useAuth } from '../../src/providers/auth-provider';

export default function AppLayout() {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Redirect href="/(auth)/login" />;

  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: '#2563EB' }}>
      <Tabs.Screen name="index"    options={{ title: 'Asosiy', tabBarIcon: ({ color }) => <Feather name="home" color={color} size={20} /> }} />
      <Tabs.Screen name="queue"    options={{ title: 'Navbat', tabBarIcon: ({ color }) => <Feather name="list" color={color} size={20} /> }} />
      <Tabs.Screen name="patients" options={{ title: 'Bemorlar', tabBarIcon: ({ color }) => <Feather name="users" color={color} size={20} /> }} />
      <Tabs.Screen name="cashier"  options={{ title: 'Kassa', tabBarIcon: ({ color }) => <Feather name="credit-card" color={color} size={20} /> }} />
    </Tabs>
  );
}
