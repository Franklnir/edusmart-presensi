import React from 'react';
import { FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchGuruClasses } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';

export function GuruClassesScreen() {
  const query = useQuery({ queryKey: ['guru-classes'], queryFn: fetchGuruClasses });

  return (
    <Screen>
      <AppText variant="label">Guru</AppText>
      <AppText variant="title">Kelas saya</AppText>
      <FlatList
        scrollEnabled={false}
        data={query.data || []}
        keyExtractor={(item, index) => `${String(item.kelas_id || index)}-${String(item.mapel || '')}`}
        ListEmptyComponent={<EmptyState title={query.isLoading ? 'Memuat kelas...' : 'Belum ada kelas'} />}
        renderItem={({ item }) => (
          <Card>
            <AppText variant="subtitle">{String(item.kelas_id || '-')}</AppText>
            <AppText>{String(item.mapel || '-')} - {String(item.student_count || 0)} siswa</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}
