import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { AuthProvider } from '@/providers/AuthProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { ThemeProvider, useTheme, useColors } from '@/providers/ThemeProvider';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BiometricGate } from '@/components/BiometricGate';
import { RootNavigator } from '@/navigation/RootNavigator';

function AppInner() {
  const { isDark } = useTheme();
  const colors = useColors();

  const navTheme = isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          primary: colors.primary,
          background: colors.bg,
          card: colors.tabBar,
          text: colors.text,
          border: colors.border,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          primary: colors.primary,
          background: colors.bg,
          card: colors.tabBar,
          text: colors.text,
          border: colors.border,
        },
      };

  return (
    <NavigationContainer theme={navTheme}>
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryProvider>
          <AuthProvider>
            <BiometricGate>
              <AppInner />
            </BiometricGate>
          </AuthProvider>
        </QueryProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
