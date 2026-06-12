import React from 'react';
import { StyleSheet, Text, TextProps } from 'react-native';
import { useColors } from '@/providers/ThemeProvider';

type Props = TextProps & {
  variant?: 'hero' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';
  color?: string;
};

export function AppText({ variant = 'body', color, style, ...props }: Props) {
  const colors = useColors();
  const variantColor = variant === 'body'
    ? colors.textSecondary
    : variant === 'caption'
      ? colors.textMuted
      : variant === 'label'
        ? colors.primary
        : colors.text;

  return (
    <Text
      {...props}
      style={[
        styles.base,
        styles[variant],
        { color: variantColor },
        color ? { color } : null,
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: 'System',
  },
  hero: {
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  title: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '500',
  },
  label: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
