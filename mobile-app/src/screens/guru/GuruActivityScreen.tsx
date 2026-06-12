import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchGuruAttendanceSummary } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { SkeletonStatGrid } from '@/components/Skeleton';
import { StatGrid } from '@/components/StatGrid';
import { useColors } from '@/providers/ThemeProvider';

export function GuruActivityScreen() {
  const colors = useColors();
  const query = useQuery({ queryKey: ['guru-attendance-summary'], queryFn: fetchGuruAttendanceSummary });
  const summary = query.data?.summary as Record<string, number> | undefined;

  return (
    <Screen refreshing={query.isFetching} onRefresh={() => query.refetch()}>
      <AppText variant="label">Aktivitas</AppText>
      <AppText variant="title">📊 Ringkasan Absensi</AppText>
      {query.isLoading ? <SkeletonStatGrid /> : (
        <StatGrid items={[
          { label: 'Hadir', value: summary?.hadir ?? 0, tone: 'green' },
          { label: 'Izin', value: summary?.izin ?? 0, tone: 'yellow' },
          { label: 'Sakit', value: summary?.sakit ?? 0, tone: 'blue' },
          { label: 'Alpha', value: summary?.alpha ?? 0, tone: 'rose' },
        ]} />
      )}
      <Card tone="indigo">
        <AppText variant="caption" style={{ textAlign: 'center', color: colors.primary }}>
          Data diambil dari database absensi tenant yang sama dengan website.
        </AppText>
      </Card>
    </Screen>
  );
}
