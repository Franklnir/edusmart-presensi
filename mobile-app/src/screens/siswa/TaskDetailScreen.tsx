import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import type { RootStackParamList } from '@/navigation/RootNavigator';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TaskDetail'>;
type Route = RouteProp<RootStackParamList, 'TaskDetail'>;

export function TaskDetailScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const { task } = route.params;
  const answer = task.answer as Record<string, unknown> | null | undefined;

  return (
    <Screen>
      <AppText variant="title">{task.judul}</AppText>

      <Card>
        <AppText variant="subtitle">Informasi Tugas</AppText>
        <AppText>Mata Pelajaran: {task.mapel || '-'}</AppText>
        <AppText>Deadline: {task.deadline || 'Tidak ada'}</AppText>
      </Card>

      {task.submitted ? (
        <Card tone="green">
          <AppText variant="subtitle">Sudah Dikumpulkan ✓</AppText>
          {answer?.waktu_submit ? (
            <AppText>Waktu submit: {String(answer.waktu_submit)}</AppText>
          ) : null}
          {answer?.status ? (
            <AppText>Status: {String(answer.status)}</AppText>
          ) : null}
          {answer?.nilai !== null && answer?.nilai !== undefined ? (
            <AppText>Nilai: {String(answer.nilai)}</AppText>
          ) : (
            <AppText>Nilai: Belum dinilai</AppText>
          )}
          {answer?.link_url ? (
            <AppText>Link: {String(answer.link_url)}</AppText>
          ) : null}
          {answer?.komentar_siswa ? (
            <AppText>Komentar: {String(answer.komentar_siswa)}</AppText>
          ) : null}
        </Card>
      ) : (
        <Card tone="yellow">
          <AppText variant="subtitle">Belum Dikumpulkan</AppText>
          <AppText>Kerjakan tugas ini sebelum deadline.</AppText>
          <Button
            label="Kerjakan Tugas"
            onPress={() => navigation.navigate('SubmitTask', { taskId: task.id, taskTitle: task.judul })}
          />
        </Card>
      )}
    </Screen>
  );
}
