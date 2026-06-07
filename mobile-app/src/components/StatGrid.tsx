import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Card } from './Card';
import { AppText } from './AppText';

export function StatGrid({ items }: { items: Array<{ label: string; value: string | number; tone?: 'white' | 'blue' | 'green' | 'yellow' }> }) {
  return (
    <View style={styles.grid}>
      {items.map(item => (
        <View key={item.label} style={styles.item}>
          <Card tone={item.tone || 'white'}>
            <AppText variant="caption">{item.label}</AppText>
            <AppText variant="subtitle">{item.value}</AppText>
          </Card>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  item: {
    flexBasis: '48%',
    flexGrow: 1,
  },
});
