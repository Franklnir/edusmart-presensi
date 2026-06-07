import React from 'react';
import { FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchSiswaTasks } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';

export function SiswaTasksScreen() {
  const query = useQuery({ queryKey: ['siswa-tasks'], queryFn: fetchSiswaTasks });

  return (
    <Screen>
      <AppText variant="label">Siswa</AppText>
      <AppText variant="title">Tugas saya</AppText>
      <FlatList
        scrollEnabled={false}
        data={query.data || []}
        keyExtractor={(item, index) => String(item.id || index)}
        ListEmptyComponent={<EmptyState title={query.isLoading ? 'Memuat tugas...' : 'Tidak ada tugas'} />}
        renderItem={({ item }) => (
          <Card tone={item.submitted ? 'green' : 'white'}>
            <AppText variant="subtitle">{String(item.judul || '-')}</AppText>
            <AppText>{String(item.mapel || '-')} - Deadline: {String(item.deadline || '-')}</AppText>
            <AppText>Status: {item.submitted ? 'Sudah dikumpulkan' : 'Belum dikumpulkan'}</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}
