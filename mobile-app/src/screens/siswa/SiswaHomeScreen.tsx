import React from 'react';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { fetchDashboard, fetchDigitalCard } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { StatGrid } from '@/components/StatGrid';
import { useAuth } from '@/providers/AuthProvider';
import { formatShortDate, greetingLabel } from '@/utils/time';

export function SiswaHomeScreen() {
  const { session } = useAuth();
  const dashboard = useQuery({ queryKey: ['siswa-dashboard'], queryFn: fetchDashboard });
  const digitalCard = useQuery({ queryKey: ['siswa-digital-card'], queryFn: fetchDigitalCard });
  const summary = dashboard.data?.summary as Record<string, number> | undefined;

  return (
    <Screen>
      <AppText variant="label">{session?.tenant.name}</AppText>
      <AppText variant="title">{greetingLabel()}, {session?.profile.nama || 'Siswa'}</AppText>
      <AppText>{formatShortDate()}</AppText>
      <StatGrid items={[
        { label: 'Hadir bulan ini', value: summary?.hadir ?? 0, tone: 'green' },
        { label: 'Alpha', value: summary?.alpha ?? 0, tone: 'yellow' },
        { label: 'Tugas aktif', value: summary?.active_tasks ?? 0, tone: 'blue' },
        { label: 'Quiz aktif', value: summary?.active_quizzes ?? 0 },
      ]} />
      <Card>
        <AppText variant="subtitle">Kartu Digital QR</AppText>
        <AppText>QR ini memakai token aman, bukan NIS atau nama polos.</AppText>
        {digitalCard.data?.token ? <QRCode value={digitalCard.data.token} size={180} /> : null}
        <AppText variant="caption">Berlaku sampai: {digitalCard.data?.expires_at || '-'}</AppText>
      </Card>
    </Screen>
  );
}
