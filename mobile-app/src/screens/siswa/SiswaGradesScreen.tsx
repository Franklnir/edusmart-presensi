import React from 'react';
import { FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchSiswaGrades } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';

export function SiswaGradesScreen() {
  const query = useQuery({ queryKey: ['siswa-grades'], queryFn: fetchSiswaGrades });
  const rows = Array.isArray(query.data?.items) ? query.data.items as Array<Record<string, unknown>> : [];

  return (
    <Screen>
      <AppText variant="label">Siswa</AppText>
      <AppText variant="title">Nilai</AppText>
      <FlatList
        scrollEnabled={false}
        data={rows}
        keyExtractor={(item, index) => String(item.id || index)}
        ListEmptyComponent={<EmptyState title={query.isLoading ? 'Memuat nilai...' : 'Belum ada nilai'} />}
        renderItem={({ item }) => (
          <Card>
            <AppText variant="subtitle">{String(item.title || '-')}</AppText>
            <AppText>{String(item.type || '-')} - Nilai: {String(item.score ?? '-')}</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}
