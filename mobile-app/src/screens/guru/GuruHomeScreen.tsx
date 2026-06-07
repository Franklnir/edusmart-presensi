import React from 'react';
import { FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard, fetchGuruSchedulesToday } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { StatGrid } from '@/components/StatGrid';
import { useAuth } from '@/providers/AuthProvider';
import { formatShortDate, greetingLabel } from '@/utils/time';

export function GuruHomeScreen() {
  const { session } = useAuth();
  const dashboard = useQuery({ queryKey: ['guru-dashboard'], queryFn: fetchDashboard });
  const schedules = useQuery({ queryKey: ['guru-schedules-today'], queryFn: fetchGuruSchedulesToday });
  const summary = dashboard.data?.summary as Record<string, number> | undefined;

  return (
    <Screen>
      <AppText variant="label">{session?.tenant.name}</AppText>
      <AppText variant="title">{greetingLabel()}, {session?.profile.nama || 'Guru'}</AppText>
      <AppText>{formatShortDate()}</AppText>
      <StatGrid items={[
        { label: 'Kelas hari ini', value: summary?.today_classes ?? 0, tone: 'blue' },
        { label: 'Absensi selesai', value: `${summary?.attendance_done ?? 0}/${summary?.today_classes ?? 0}`, tone: 'green' },
        { label: 'Belum absen', value: summary?.missing_attendance ?? 0, tone: 'yellow' },
        { label: 'Queue offline', value: summary?.offline_queue ?? 0 },
      ]} />
      <AppText variant="subtitle">Jadwal Hari Ini</AppText>
      <FlatList
        data={schedules.data || []}
        scrollEnabled={false}
        keyExtractor={(item, index) => String(item.id || index)}
        ListEmptyComponent={<EmptyState title={schedules.isLoading ? 'Memuat jadwal...' : 'Tidak ada jadwal'} />}
        renderItem={({ item }) => (
          <Card>
            <AppText variant="subtitle">{String(item.mapel || '-')} - {String(item.kelas_id || '-')}</AppText>
            <AppText>{String(item.jam_mulai || '')} - {String(item.jam_selesai || '')}</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}
