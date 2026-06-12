import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { AppText } from './AppText';

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: string }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 500,
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={[styles.root, { opacity: fadeAnim }]}>
      {icon ? <AppText style={styles.icon}>{icon}</AppText> : null}
      <AppText variant="subtitle" style={styles.title}>{title}</AppText>
      {description ? <AppText style={styles.description}>{description}</AppText> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 20,
    backgroundColor: '#f8fafc',
  },
  icon: {
    fontSize: 36,
    marginBottom: 8,
  },
  title: {
    textAlign: 'center',
    color: '#64748b',
  },
  description: {
    textAlign: 'center',
    marginTop: 4,
    color: '#94a3b8',
  },
});
