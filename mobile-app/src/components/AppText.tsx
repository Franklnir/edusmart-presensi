import React from 'react';
import { StyleSheet, Text, TextProps } from 'react-native';

type Props = TextProps & {
  variant?: 'title' | 'subtitle' | 'body' | 'caption' | 'label';
  color?: string;
};

export function AppText({ variant = 'body', color, style, ...props }: Props) {
  return <Text {...props} style={[styles.base, styles[variant], color ? { color } : null, style]} />;
}

const styles = StyleSheet.create({
  base: {
    color: '#0f172a',
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: '700',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    color: '#334155',
  },
  caption: {
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#4f46e5',
    textTransform: 'uppercase',
  },
});
