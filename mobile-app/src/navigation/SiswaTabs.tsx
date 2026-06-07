import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SiswaHomeScreen } from '@/screens/siswa/SiswaHomeScreen';
import { SiswaAttendanceScreen } from '@/screens/siswa/SiswaAttendanceScreen';
import { SiswaTasksScreen } from '@/screens/siswa/SiswaTasksScreen';
import { SiswaGradesScreen } from '@/screens/siswa/SiswaGradesScreen';
import { ProfileScreen } from '@/screens/shared/ProfileScreen';

export type SiswaTabParamList = {
  Beranda: undefined;
  Absensi: undefined;
  Tugas: undefined;
  Nilai: undefined;
  Profil: undefined;
};

const Tab = createBottomTabNavigator<SiswaTabParamList>();

export function SiswaTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: '#4f46e5',
        tabBarLabelStyle: { fontWeight: '700' },
      }}
    >
      <Tab.Screen name="Beranda" component={SiswaHomeScreen} />
      <Tab.Screen name="Absensi" component={SiswaAttendanceScreen} />
      <Tab.Screen name="Tugas" component={SiswaTasksScreen} />
      <Tab.Screen name="Nilai" component={SiswaGradesScreen} />
      <Tab.Screen name="Profil" component={ProfileScreen} />
    </Tab.Navigator>
  );
}
