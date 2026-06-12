import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/providers/AuthProvider';
import { SchoolPickerScreen } from '@/screens/auth/SchoolPickerScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { GuruTabs } from './GuruTabs';
import { SiswaTabs } from './SiswaTabs';

export type RootStackParamList = {
  SchoolPicker: undefined;
  Login: undefined;
  Guru: undefined;
  Siswa: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { booting, session, tenant } = useAuth();

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  const initialRoute = session?.profile.role === 'guru'
    ? 'Guru'
    : session?.profile.role === 'siswa'
      ? 'Siswa'
      : tenant
        ? 'Login'
        : 'SchoolPicker';
  const navigatorKey = `${session?.profile.role || 'guest'}-${tenant?.id || 'no-tenant'}`;

  return (
    <Stack.Navigator key={navigatorKey} initialRouteName={initialRoute} screenOptions={{ headerShown: false }}>
      <Stack.Screen name="SchoolPicker" component={SchoolPickerScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Guru" component={GuruTabs} />
      <Stack.Screen name="Siswa" component={SiswaTabs} />
    </Stack.Navigator>
  );
}
