import React from 'react';
import { FlatList } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchSiswaAttendance, fetchSiswaSchedules } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { StatGrid } from '@/components/StatGrid';

export function SiswaAttendanceScreen() {
  const attendance = useQuery({ queryKey: ['siswa-attendance'], queryFn: fetchSiswaAttendance });
  const schedules = useQuery({ queryKey: ['siswa-schedules'], queryFn: fetchSiswaSchedules });
  const summary = attendance.data?.summary as Record<string, number> | undefined;

  return (
    <Screen>
      <AppText variant="label">Siswa</AppText>
      <AppText variant="title">Absensi saya</AppText>
      <StatGrid items={[
        { label: 'Hadir', value: summary?.hadir ?? 0, tone: 'green' },
        { label: 'Izin', value: summary?.izin ?? 0, tone: 'yellow' },
        { label: 'Sakit', value: summary?.sakit ?? 0, tone: 'blue' },
        { label: 'Alpha', value: summary?.alpha ?? 0 },
      ]} />
      <AppText variant="subtitle">Jadwal</AppText>
      <FlatList
        scrollEnabled={false}
        data={schedules.data || []}
        keyExtractor={(item, index) => String(item.id || index)}
        ListEmptyComponent={<EmptyState title={schedules.isLoading ? 'Memuat jadwal...' : 'Tidak ada jadwal'} />}
        renderItem={({ item }) => (
          <Card>
            <AppText variant="subtitle">{String(item.mapel || '-')}</AppText>
            <AppText>{String(item.hari || '-')} - {String(item.jam_mulai || '')} s/d {String(item.jam_selesai || '')}</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}
