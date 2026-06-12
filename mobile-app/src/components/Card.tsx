import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, ViewStyle } from 'react-native';
import { useColors } from '@/providers/ThemeProvider';

type Tone = 'white' | 'blue' | 'green' | 'yellow' | 'indigo' | 'rose';

type Props = {
  children: React.ReactNode;
  tone?: Tone;
  style?: ViewStyle;
  animated?: boolean;
};

export function Card({ children, tone = 'white', style, animated = true }: Props) {
  const colors = useColors();
  const fadeAnim = useRef(new Animated.Value(animated ? 0 : 1)).current;
  const slideAnim = useRef(new Animated.Value(animated ? 12 : 0)).current;

  const toneStyles: Record<Tone, ViewStyle> = {
    white: { backgroundColor: colors.bgCard, borderColor: colors.border },
    blue: { backgroundColor: colors.infoBg, borderColor: colors.info + '40' },
    green: { backgroundColor: colors.successBg, borderColor: colors.success + '40' },
    yellow: { backgroundColor: colors.warningBg, borderColor: colors.warning + '40' },
    indigo: { backgroundColor: colors.primaryLight, borderColor: colors.primary + '40' },
    rose: { backgroundColor: colors.dangerBg, borderColor: colors.danger + '40' },
  };

  useEffect(() => {
    if (!animated) return;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
    ]).start();
  }, [animated, fadeAnim, slideAnim]);

  const cardStyle: ViewStyle = {
    ...styles.card,
    ...toneStyles[tone],
    shadowColor: colors.shadow,
    ...style,
  };

  if (!animated) {
    return <Animated.View style={cardStyle}>{children}</Animated.View>;
  }

  return (
    <Animated.View
      style={[cardStyle, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    gap: 10,
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
});
