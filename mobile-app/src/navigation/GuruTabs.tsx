import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppText } from '@/components/AppText';
import { useColors } from '@/providers/ThemeProvider';
import { GuruHomeScreen } from '@/screens/guru/GuruHomeScreen';
import { GuruScanScreen } from '@/screens/guru/GuruScanScreen';
import { GuruClassesScreen } from '@/screens/guru/GuruClassesScreen';
import { GuruActivityScreen } from '@/screens/guru/GuruActivityScreen';
import { ProfileScreen } from '@/screens/shared/ProfileScreen';

export type GuruTabParamList = {
  Beranda: undefined;
  Absensi: undefined;
  Kelas: undefined;
  Aktivitas: undefined;
  Profil: undefined;
};

const Tab = createBottomTabNavigator<GuruTabParamList>();

const TAB_ICONS: Record<string, string> = {
  Beranda: '🏠',
  Absensi: '📡',
  Kelas: '🏫',
  Aktivitas: '📊',
  Profil: '👤',
};

export function GuruTabs() {
  const colors = useColors();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.tabActive,
        tabBarInactiveTintColor: colors.tabInactive,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopWidth: 0,
          shadowColor: colors.shadow,
          shadowOpacity: 0.08,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: -4 },
          elevation: 8,
          height: 60,
          paddingBottom: 8,
          paddingTop: 6,
        },
        tabBarLabelStyle: {
          fontWeight: '700',
          fontSize: 10,
          letterSpacing: 0.3,
        },
        tabBarIcon: () => (
          <AppText style={{ fontSize: 20 }}>{TAB_ICONS[route.name] || '📋'}</AppText>
        ),
      })}
    >
      <Tab.Screen name="Beranda" component={GuruHomeScreen} />
      <Tab.Screen name="Absensi" component={GuruScanScreen} />
      <Tab.Screen name="Kelas" component={GuruClassesScreen} />
      <Tab.Screen name="Aktivitas" component={GuruActivityScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
