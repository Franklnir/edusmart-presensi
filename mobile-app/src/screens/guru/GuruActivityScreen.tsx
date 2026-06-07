import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGuruAttendanceSummary } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StatGrid } from '@/components/StatGrid';

export function GuruActivityScreen() {
  const query = useQuery({ queryKey: ['guru-attendance-summary'], queryFn: fetchGuruAttendanceSummary });
  const summary = query.data?.summary as Record<string, number> | undefined;

  return (
    <Screen>
      <AppText variant="label">Aktivitas</AppText>
      <AppText variant="title">Ringkasan absensi</AppText>
      <StatGrid items={[
        { label: 'Hadir', value: summary?.hadir ?? 0, tone: 'green' },
        { label: 'Izin', value: summary?.izin ?? 0, tone: 'yellow' },
        { label: 'Sakit', value: summary?.sakit ?? 0, tone: 'blue' },
        { label: 'Alpha', value: summary?.alpha ?? 0 },
      ]} />
      <Card>
        <AppText>Data diambil dari database absensi tenant yang sama dengan website.</AppText>
      </Card>
    </Screen>
  );
}
