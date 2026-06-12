import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { Card } from './Card';
import { AppText } from './AppText';

type StatItem = {
  label: string;
  value: string | number;
  tone?: 'white' | 'blue' | 'green' | 'yellow' | 'indigo' | 'rose';
};

export function StatGrid({ items }: { items: StatItem[] }) {
  return (
    <View style={styles.grid}>
      {items.map((item, index) => (
        <StatCard key={item.label} item={item} delay={index * 80} />
      ))}
    </View>
  );
}

function StatCard({ item, delay }: { item: StatItem; delay: number }) {
  const scaleAnim = useRef(new Animated.Value(0.9)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 400,
        delay,
        useNativeDriver: true,
      }),
      Animated.spring(scaleAnim, {
        toValue: 1,
        delay,
        useNativeDriver: true,
        speed: 12,
        bounciness: 8,
      }),
    ]).start();
  }, [delay, fadeAnim, scaleAnim]);

  return (
    <Animated.View
      style={[
        styles.item,
        { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
      ]}
    >
      <Card tone={item.tone || 'white'} animated={false}>
        <AppText variant="caption">{item.label}</AppText>
        <AppText variant="title" style={styles.value}>{item.value}</AppText>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  item: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  value: {
    fontSize: 22,
  },
});
