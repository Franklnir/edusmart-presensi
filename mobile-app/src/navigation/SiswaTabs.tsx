import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { AppText } from '@/components/AppText';
import { useColors } from '@/providers/ThemeProvider';
import { SiswaHomeScreen } from '@/screens/siswa/SiswaHomeScreen';
import { SiswaAttendanceScreen } from '@/screens/siswa/SiswaAttendanceScreen';
import { SiswaTasksScreen } from '@/screens/siswa/SiswaTasksScreen';
import { SiswaQuizScreen } from '@/screens/siswa/SiswaQuizScreen';
import { ProfileScreen } from '@/screens/shared/ProfileScreen';

export type SiswaTabParamList = {
  Beranda: undefined;
  Absensi: undefined;
  Tugas: undefined;
  Quiz: undefined;
  Profil: undefined;
};

const Tab = createBottomTabNavigator<SiswaTabParamList>();

const TAB_ICONS: Record<string, string> = {
  Beranda: '🏠',
  Absensi: '✅',
  Tugas: '📝',
  Quiz: '🧠',
  Profil: '👤',
};

export function SiswaTabs() {
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
      <Tab.Screen name="Beranda" component={SiswaHomeScreen} />
      <Tab.Screen name="Absensi" component={SiswaAttendanceScreen} />
      <Tab.Screen name="Tugas" component={SiswaTasksScreen} />
      <Tab.Screen name="Quiz" component={SiswaQuizScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
