import React from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { fetchQuizDashboard } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { SkeletonCard } from '@/components/Skeleton';
import { useAuth } from '@/providers/AuthProvider';
import { useColors } from '@/providers/ThemeProvider';
import type { RootStackParamList } from '@/navigation/RootNavigator';
import type { QuizListItem } from '@/types/mobile';

type Nav = NativeStackNavigationProp<RootStackParamList>;

function quizStatusLabel(item: QuizListItem): { label: string; icon: string; tone: 'green' | 'yellow' | 'blue' | 'white' } {
  const submission = item.submission;
  if (submission?.status === 'finished') {
    return { label: `Selesai — Nilai: ${submission.score ?? '-'}`, icon: '✅', tone: 'green' };
  }
  if (submission?.status === 'ongoing') {
    return { label: 'Sedang dikerjakan', icon: '✏️', tone: 'yellow' };
  }
  if (item.is_live || item.is_active) {
    return { label: 'Tersedia', icon: '🟢', tone: 'blue' };
  }
  return { label: 'Belum tersedia', icon: '🔒', tone: 'white' };
}

export function SiswaQuizScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const kelas = session?.profile.kelas || '';
  const query = useQuery({
    queryKey: ['siswa-quiz-dashboard', kelas],
    queryFn: () => fetchQuizDashboard(kelas),
  });
  const navigation = useNavigation<Nav>();

  const rows = query.data?.rows ?? [];

  return (
    <Screen refreshing={query.isFetching} onRefresh={() => query.refetch()}>
      <AppText variant="label">Siswa</AppText>
      <AppText variant="title">🧠 Quiz</AppText>
      {query.isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : (
        <FlatList
          scrollEnabled={false}
          data={rows}
          keyExtractor={(item, index) => String(item.id || index)}
          ListEmptyComponent={
            <EmptyState icon="📝" title="Tidak ada quiz aktif" description="Quiz baru akan muncul di sini." />
          }
          renderItem={({ item }) => {
            const status = quizStatusLabel(item);
            return (
              <TouchableOpacity onPress={() => navigation.navigate('QuizDetail', { quizId: item.id })}>
                <Card tone={status.tone}>
                  <View style={styles.quizHeader}>
                    <AppText style={{ fontSize: 20 }}>{status.icon}</AppText>
                    <View style={{ flex: 1 }}>
                      <AppText variant="subtitle">{item.nama || '-'}</AppText>
                      <AppText variant="caption">{item.mapel || '-'} — {item.question_count || 0} soal</AppText>
                    </View>
                  </View>
                  {item.duration_minutes ? (
                    <AppText variant="caption">⏱ Durasi: {item.duration_minutes} menit</AppText>
                  ) : null}
                  {item.deadline_at ? (
                    <AppText variant="caption">📅 Deadline: {item.deadline_at}</AppText>
                  ) : null}
                  <AppText variant="caption">{status.label}</AppText>
                </Card>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  quizHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});
