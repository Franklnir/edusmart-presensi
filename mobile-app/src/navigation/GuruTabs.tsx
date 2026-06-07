import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { GuruHomeScreen } from '@/screens/guru/GuruHomeScreen';
import { GuruScanScreen } from '@/screens/guru/GuruScanScreen';
import { GuruClassesScreen } from '@/screens/guru/GuruClassesScreen';
import { GuruActivityScreen } from '@/screens/guru/GuruActivityScreen';
import { ProfileScreen } from '@/screens/shared/ProfileScreen';

export type GuruTabParamList = {
  Beranda: undefined;
  Scan: undefined;
  Kelas: undefined;
  Aktivitas: undefined;
  Profil: undefined;
};

const Tab = createBottomTabNavigator<GuruTabParamList>();

export function GuruTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4f46e5',
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      <Tab.Screen name="Beranda" component={GuruHomeScreen} />
      <Tab.Screen name="Scan" component={GuruScanScreen} />
      <Tab.Screen name="Kelas" component={GuruClassesScreen} />
      <Tab.Screen name="Aktivitas" component={GuruActivityScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
