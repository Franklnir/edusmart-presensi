import React from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from './AppText';

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <View style={styles.root}>
      <AppText variant="subtitle">{title}</AppText>
      {description ? <AppText style={styles.description}>{description}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderStyle: 'dashed',
    borderRadius: 20,
    backgroundColor: '#ffffff',
  },
  description: {
    textAlign: 'center',
    marginTop: 4,
  },
});
