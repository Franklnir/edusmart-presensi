import React from 'react';
import { StyleSheet, View } from 'react-native';

export function Card({ children, tone = 'white' }: { children: React.ReactNode; tone?: 'white' | 'blue' | 'green' | 'yellow' }) {
  return <View style={[styles.card, styles[tone]]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#dbe4f0',
    padding: 18,
    gap: 12,
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  white: { backgroundColor: '#ffffff' },
  blue: { backgroundColor: '#eff6ff', borderColor: '#bfdbfe' },
  green: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  yellow: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },
});
