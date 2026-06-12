import React from 'react';
import { FlatList, TouchableOpacity } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { fetchSiswaTasks } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { SkeletonCard } from '@/components/Skeleton';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import type { TaskItem } from '@/types/mobile';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function SiswaTasksScreen() {
  const query = useQuery({ queryKey: ['siswa-tasks'], queryFn: fetchSiswaTasks });
  const navigation = useNavigation<Nav>();

  return (
    <Screen refreshing={query.isFetching} onRefresh={() => query.refetch()}>
      <AppText variant="label">Siswa</AppText>
      <AppText variant="title">📝 Tugas saya</AppText>
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
          keyExtractor={(item, index) => String(item.id || index)}
          ListEmptyComponent={
            <EmptyState icon="🎉" title="Tidak ada tugas" description="Kamu sudah menyelesaikan semua tugas!" />
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => navigation.navigate('TaskDetail', { task: item as TaskItem })}>
              <Card tone={item.submitted ? 'green' : 'white'}>
                <AppText variant="subtitle">{String(item.judul || '-')}</AppText>
                <AppText>{String(item.mapel || '-')} — Deadline: {String(item.deadline || '-')}</AppText>
                <AppText variant="caption">
                  {item.submitted ? '✅ Sudah dikumpulkan' : '⏳ Belum dikumpulkan'}
                </AppText>
              </Card>
            </TouchableOpacity>
          )}
        />
      )}
    </Screen>
  );
}
