import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { AppText } from './AppText';

type Props = {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: 'primary' | 'secondary' | 'danger';
};

export function Button({ label, onPress, loading, disabled, tone = 'primary' }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[tone],
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      {loading ? <ActivityIndicator color={tone === 'secondary' ? '#1e293b' : '#ffffff'} /> : (
        <AppText style={[styles.label, tone === 'secondary' && styles.secondaryText]}>{label}</AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  primary: {
    backgroundColor: '#4f46e5',
  },
  secondary: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dbe4f0',
  },
  danger: {
    backgroundColor: '#dc2626',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    transform: [{ scale: 0.99 }],
  },
  label: {
    color: '#ffffff',
    fontWeight: '800',
    fontSize: 15,
  },
  secondaryText: {
    color: '#1e293b',
  },
});
