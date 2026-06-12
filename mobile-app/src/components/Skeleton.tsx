import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

type Props = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export function Skeleton({ width = '100%', height = 16, borderRadius = 10, style }: Props) {
  const shimmerAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerAnim, { toValue: 0.7, duration: 800, useNativeDriver: true }),
        Animated.timing(shimmerAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [shimmerAnim]);

  return (
    <Animated.View
      style={[
        styles.bone,
        {
          width: width as number,
          height,
          borderRadius,
          opacity: shimmerAnim,
        },
        style,
      ]}
    />
  );
}

export function SkeletonCard() {
  return (
    <View style={styles.card}>
      <Skeleton width="60%" height={14} />
      <Skeleton width="100%" height={10} />
      <Skeleton width="80%" height={10} />
    </View>
  );
}

export function SkeletonStatGrid() {
  return (
    <View style={styles.grid}>
      {[0, 1, 2, 3].map(i => (
        <View key={i} style={styles.gridItem}>
          <View style={styles.card}>
            <Skeleton width="50%" height={10} />
            <Skeleton width="40%" height={20} borderRadius={6} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  bone: {
    backgroundColor: '#e2e8f0',
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 20,
    gap: 10,
    backgroundColor: '#ffffff',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    flexBasis: '47%',
    flexGrow: 1,
  },
});
