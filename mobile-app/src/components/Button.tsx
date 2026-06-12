import React, { useRef } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, ViewStyle } from 'react-native';
import { AppText } from './AppText';
import { useColors } from '@/providers/ThemeProvider';
import { hapticLight } from '@/utils/haptics';

type Tone = 'primary' | 'secondary' | 'danger' | 'success' | 'ghost' | 'google';

type Props = {
  label: string;
  onPress?: () => void;
  loading?: boolean;
  disabled?: boolean;
  tone?: Tone;
  icon?: string;
  style?: ViewStyle;
  compact?: boolean;
};

export function Button({ label, onPress, loading, disabled, tone = 'primary', icon, style, compact }: Props) {
  const colors = useColors();
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const toneConfig: Record<Tone, { bg: string; text: string; border?: string }> = {
    primary: { bg: colors.primary, text: colors.textInverse },
    secondary: { bg: colors.bgSecondary, text: colors.text, border: colors.border },
    danger: { bg: colors.danger, text: colors.textInverse },
    success: { bg: colors.success, text: colors.textInverse },
    ghost: { bg: 'transparent', text: colors.primary },
    google: { bg: colors.bgCard, text: colors.text, border: colors.border },
  };
  const config = toneConfig[tone];

  const handlePressIn = () => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  };

  const handlePress = () => {
    hapticLight();
    onPress?.();
  };

  return (
    <Animated.View style={[{ transform: [{ scale: scaleAnim }] }, style]}>
      <Pressable
        accessibilityRole="button"
        disabled={disabled || loading}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[
          styles.button,
          compact && styles.compact,
          { backgroundColor: config.bg },
          config.border ? { borderWidth: 1, borderColor: config.border } : null,
          (disabled || loading) && styles.disabled,
          { shadowColor: colors.shadowAccent },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={config.text} size="small" />
        ) : (
          <>
            {icon ? <AppText style={{ fontSize: 18, marginRight: 6 }}>{icon}</AppText> : null}
            <AppText style={[styles.label, { color: config.text }]}>{label}</AppText>
          </>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    flexDirection: 'row',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  compact: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.2,
  },
});
