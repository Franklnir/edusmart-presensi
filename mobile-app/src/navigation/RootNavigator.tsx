import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useAuth } from '@/providers/AuthProvider';
import { useColors, useTheme } from '@/providers/ThemeProvider';
import { AppText } from '@/components/AppText';
import { SchoolPickerScreen } from '@/screens/auth/SchoolPickerScreen';
import { LoginScreen } from '@/screens/auth/LoginScreen';
import { TaskDetailScreen } from '@/screens/siswa/TaskDetailScreen';
import { SubmitTaskScreen } from '@/screens/siswa/SubmitTaskScreen';
import { QuizDetailScreen } from '@/screens/siswa/QuizDetailScreen';
import { QuizWorkScreen } from '@/screens/siswa/QuizWorkScreen';
import { GuruTabs } from './GuruTabs';
import { SiswaTabs } from './SiswaTabs';
import type { TaskItem } from '@/types/mobile';

export type RootStackParamList = {
  SchoolPicker: undefined;
  Login: undefined;
  Guru: undefined;
  Siswa: undefined;
  TaskDetail: { task: TaskItem };
  SubmitTask: { taskId: string; taskTitle: string };
  QuizDetail: { quizId: string };
  QuizWork: { quizId: string; submissionId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

function SplashScreen() {
  const colors = useColors();
  const pulseAnim = useRef(new Animated.Value(0.8)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.8, duration: 800, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulseAnim]);

  return (
    <View style={[splashStyles.root, { backgroundColor: colors.bg }]}>
      <Animated.View style={[splashStyles.logo, { backgroundColor: colors.primaryLight, transform: [{ scale: pulseAnim }] }]}>
        <AppText style={splashStyles.logoEmoji}>📚</AppText>
      </Animated.View>
      <AppText variant="title" style={{ color: colors.primaryDark }}>SISMU Mobile</AppText>
      <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 16 }} />
    </View>
  );
}

const splashStyles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.2,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  logoEmoji: {
    fontSize: 36,
  },
});

export function RootNavigator() {
  const { booting, session, tenant } = useAuth();
  const { isDark } = useTheme();
  const colors = useColors();

  if (booting) {
    return <SplashScreen />;
  }

  const initialRoute = session?.profile.role === 'guru'
    ? 'Guru'
    : session?.profile.role === 'siswa'
      ? 'Siswa'
      : tenant
        ? 'Login'
        : 'SchoolPicker';
  const navigatorKey = `${session?.profile.role || 'guest'}-${tenant?.id || 'no-tenant'}`;

  const detailScreenOptions = {
    headerShown: true,
    headerStyle: { backgroundColor: colors.bg },
    headerTintColor: colors.primary,
    headerTitleStyle: { fontWeight: '700' as const },
  };

  return (
    <Stack.Navigator
      key={navigatorKey}
      initialRouteName={initialRoute}
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="SchoolPicker" component={SchoolPickerScreen} />
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Guru" component={GuruTabs} />
      <Stack.Screen name="Siswa" component={SiswaTabs} />
      <Stack.Screen
        name="TaskDetail"
        component={TaskDetailScreen}
        options={{ ...detailScreenOptions, title: 'Detail Tugas' }}
      />
      <Stack.Screen
        name="SubmitTask"
        component={SubmitTaskScreen}
        options={{ ...detailScreenOptions, title: 'Kerjakan Tugas' }}
      />
      <Stack.Screen
        name="QuizDetail"
        component={QuizDetailScreen}
        options={{ ...detailScreenOptions, title: 'Detail Quiz' }}
      />
      <Stack.Screen
        name="QuizWork"
        component={QuizWorkScreen}
        options={{ ...detailScreenOptions, title: 'Kerjakan Quiz', headerBackVisible: false }}
      />
    </Stack.Navigator>
  );
}
