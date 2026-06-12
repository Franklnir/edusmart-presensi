import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';

export type ThemeColors = {
  // Backgrounds
  bg: string;
  bgSecondary: string;
  bgCard: string;
  bgElevated: string;
  bgAccent: string;

  // Text
  text: string;
  textSecondary: string;
  textMuted: string;
  textInverse: string;

  // Borders
  border: string;
  borderLight: string;

  // Brand
  primary: string;
  primaryLight: string;
  primaryDark: string;

  // Status
  success: string;
  successBg: string;
  warning: string;
  warningBg: string;
  danger: string;
  dangerBg: string;
  info: string;
  infoBg: string;

  // Shadows
  shadow: string;
  shadowAccent: string;

  // Tab bar
  tabBar: string;
  tabActive: string;
  tabInactive: string;

  // Input
  inputBg: string;
  inputBorder: string;
  placeholder: string;
};

const lightColors: ThemeColors = {
  bg: '#f8fafc',
  bgSecondary: '#f1f5f9',
  bgCard: '#ffffff',
  bgElevated: '#ffffff',
  bgAccent: '#eef2ff',

  text: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  textInverse: '#ffffff',

  border: '#e2e8f0',
  borderLight: '#f1f5f9',

  primary: '#4f46e5',
  primaryLight: '#eef2ff',
  primaryDark: '#312e81',

  success: '#10b981',
  successBg: '#ecfdf5',
  warning: '#f59e0b',
  warningBg: '#fffbeb',
  danger: '#ef4444',
  dangerBg: '#fef2f2',
  info: '#3b82f6',
  infoBg: '#eff6ff',

  shadow: '#0f172a',
  shadowAccent: '#4f46e5',

  tabBar: '#ffffff',
  tabActive: '#4f46e5',
  tabInactive: '#94a3b8',

  inputBg: '#f8fafc',
  inputBorder: '#e2e8f0',
  placeholder: '#94a3b8',
};

const darkColors: ThemeColors = {
  bg: '#0f172a',
  bgSecondary: '#1e293b',
  bgCard: '#1e293b',
  bgElevated: '#334155',
  bgAccent: '#1e1b4b',

  text: '#f1f5f9',
  textSecondary: '#cbd5e1',
  textMuted: '#64748b',
  textInverse: '#0f172a',

  border: '#334155',
  borderLight: '#1e293b',

  primary: '#818cf8',
  primaryLight: '#1e1b4b',
  primaryDark: '#c7d2fe',

  success: '#34d399',
  successBg: '#064e3b',
  warning: '#fbbf24',
  warningBg: '#451a03',
  danger: '#f87171',
  dangerBg: '#450a0a',
  info: '#60a5fa',
  infoBg: '#172554',

  shadow: '#000000',
  shadowAccent: '#818cf8',

  tabBar: '#1e293b',
  tabActive: '#818cf8',
  tabInactive: '#64748b',

  inputBg: '#334155',
  inputBorder: '#475569',
  placeholder: '#64748b',
};

type Theme = {
  colors: ThemeColors;
  isDark: boolean;
};

const ThemeContext = createContext<Theme>({
  colors: lightColors,
  isDark: false,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const theme = useMemo<Theme>(() => ({
    colors: isDark ? darkColors : lightColors,
    isDark,
  }), [isDark]);

  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function useColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}
