import React from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchGuruClasses } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { SkeletonCard } from '@/components/Skeleton';
import { useColors } from '@/providers/ThemeProvider';

export function GuruClassesScreen() {
  const colors = useColors();
  const query = useQuery({ queryKey: ['guru-classes'], queryFn: fetchGuruClasses });

  return (
    <Screen refreshing={query.isFetching} onRefresh={() => query.refetch()}>
      <AppText variant="label">Guru</AppText>
      <AppText variant="title">🏫 Kelas Saya</AppText>
      {query.isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : (
        <FlatList
          scrollEnabled={false}
          data={query.data || []}
          keyExtractor={(item, index) => `${String(item.kelas_id || index)}-${String(item.mapel || '')}`}
          ListEmptyComponent={
            <EmptyState icon="📚" title="Belum ada kelas" />
          }
          renderItem={({ item }) => (
            <Card tone="white">
              <View style={styles.classRow}>
                <View style={[styles.classIcon, { backgroundColor: colors.infoBg }]}>
                  <AppText style={{ fontSize: 22 }}>📖</AppText>
                </View>
                <View style={styles.classInfo}>
                  <AppText variant="subtitle">{String(item.kelas_id || '-')}</AppText>
                  <AppText>{String(item.mapel || '-')}</AppText>
                  <AppText variant="caption">{String(item.student_count || 0)} siswa</AppText>
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  classIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  classInfo: {
    flex: 1,
    gap: 2,
  },
});
