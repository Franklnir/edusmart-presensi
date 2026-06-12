import React, { useState } from 'react';
import { Alert } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchQuizDetail, postQuizStart } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StatGrid } from '@/components/StatGrid';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'QuizDetail'>;
type Route = RouteProp<RootStackParamList, 'QuizDetail'>;

export function QuizDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const queryClient = useQueryClient();
  const { quizId } = route.params;
  const [starting, setStarting] = useState(false);

  const query = useQuery({
    queryKey: ['quiz-detail', quizId],
    queryFn: () => fetchQuizDetail(quizId),
  });

  const data = query.data;
  const quiz = data?.quiz;
  const submission = data?.submission;
  const questions = data?.questions ?? [];

  const isFinished = submission?.status === 'finished';
  const isOngoing = submission?.status === 'ongoing';

  async function handleStart() {
    Alert.alert(
      'Mulai Quiz',
      'Setelah dimulai, timer akan berjalan dan tidak bisa dihentikan. Lanjutkan?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Mulai',
          onPress: async () => {
            setStarting(true);
            try {
              const result = await postQuizStart(quizId);
              queryClient.invalidateQueries({ queryKey: ['quiz-detail', quizId] });
              navigation.replace('QuizWork', {
                quizId,
                submissionId: result.submission.id,
              });
            } catch (err) {
              Alert.alert('Gagal', err instanceof Error ? err.message : 'Tidak bisa memulai quiz.');
            } finally {
              setStarting(false);
            }
          },
        },
      ],
    );
  }

  function handleContinue() {
    if (submission) {
      navigation.replace('QuizWork', {
        quizId,
        submissionId: submission.id,
      });
    }
  }

  if (query.isLoading) {
    return (
      <Screen>
        <AppText>Memuat detail quiz...</AppText>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText variant="title">{String(quiz?.nama || 'Quiz')}</AppText>

      <Card>
        <AppText variant="subtitle">Informasi Quiz</AppText>
        <AppText>Mata Pelajaran: {String(quiz?.mapel || '-')}</AppText>
        <AppText>Jumlah Soal: {questions.length}</AppText>
        {quiz?.duration_minutes ? (
          <AppText>Durasi: {String(quiz.duration_minutes)} menit</AppText>
        ) : null}
        {quiz?.deadline_at ? (
          <AppText>Deadline: {String(quiz.deadline_at)}</AppText>
        ) : null}
      </Card>

      {isFinished ? (
        <Card tone="green">
          <AppText variant="subtitle">Quiz Selesai ✓</AppText>
          <StatGrid items={[
            { label: 'Nilai', value: submission?.score ?? '-', tone: 'green' },
            { label: 'Total Poin', value: submission?.total_points ?? '-', tone: 'blue' },
          ]} />
        </Card>
      ) : isOngoing ? (
        <Card tone="yellow">
          <AppText variant="subtitle">Quiz Sedang Berlangsung</AppText>
          <AppText>Kamu sudah memulai quiz ini. Lanjutkan mengerjakan.</AppText>
          <Button label="Lanjutkan Quiz" onPress={handleContinue} />
        </Card>
      ) : (
        <Card tone="blue">
          <AppText variant="subtitle">Quiz Tersedia</AppText>
          <AppText>Pastikan koneksi stabil sebelum memulai.</AppText>
          <Button label="Mulai Quiz" loading={starting} onPress={handleStart} />
        </Card>
      )}
    </Screen>
  );
}
