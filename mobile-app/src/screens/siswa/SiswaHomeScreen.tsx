import React, { useEffect, useRef } from 'react';
import { Animated, FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-native-qrcode-svg';
import { fetchDashboard, fetchDigitalCard, fetchSiswaGrades } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { SkeletonCard, SkeletonStatGrid } from '@/components/Skeleton';
import { StatGrid } from '@/components/StatGrid';
import { useAuth } from '@/providers/AuthProvider';
import { useColors } from '@/providers/ThemeProvider';
import { formatShortDate, greetingLabel } from '@/utils/time';

export function SiswaHomeScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const dashboard = useQuery({ queryKey: ['siswa-dashboard'], queryFn: fetchDashboard });
  const digitalCard = useQuery({ queryKey: ['siswa-digital-card'], queryFn: fetchDigitalCard });
  const grades = useQuery({ queryKey: ['siswa-grades'], queryFn: fetchSiswaGrades });
  const summary = dashboard.data?.summary as Record<string, number> | undefined;
  const gradeRows = Array.isArray(grades.data?.items) ? grades.data.items as Array<Record<string, unknown>> : [];
  const isLoading = dashboard.isLoading;

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [headerAnim]);

  const handleRefresh = () => {
    dashboard.refetch();
    digitalCard.refetch();
    grades.refetch();
  };

  return (
    <Screen
      refreshing={dashboard.isFetching || grades.isFetching}
      onRefresh={handleRefresh}
    >
      {/* Greeting Header */}
      <Animated.View style={[styles.header, { opacity: headerAnim }]}>
        <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight }]}>
          <AppText style={styles.avatarEmoji}>🎒</AppText>
        </View>
        <View style={styles.headerText}>
          <AppText variant="caption">{session?.tenant.name}</AppText>
          <AppText variant="title">{greetingLabel()},</AppText>
          <AppText variant="subtitle">{session?.profile.nama || 'Siswa'}</AppText>
        </View>
      </Animated.View>

      <Card tone="indigo" animated={false}>
        <AppText style={[styles.dateText, { color: colors.primary }]}>📅 {formatShortDate()}</AppText>
      </Card>

      {/* Stats */}
      {isLoading ? <SkeletonStatGrid /> : (
        <StatGrid items={[
          { label: 'Hadir bulan ini', value: summary?.hadir ?? 0, tone: 'green' },
          { label: 'Alpha', value: summary?.alpha ?? 0, tone: 'yellow' },
          { label: 'Tugas aktif', value: summary?.active_tasks ?? 0, tone: 'blue' },
          { label: 'Quiz aktif', value: summary?.active_quizzes ?? 0, tone: 'indigo' },
        ]} />
      )}

      {/* Digital Card */}
      <Card tone="white">
        <View style={styles.qrHeader}>
          <AppText style={{ fontSize: 22 }}>🪪</AppText>
          <View style={{ flex: 1 }}>
            <AppText variant="subtitle">Kartu Digital</AppText>
            <AppText variant="caption">Token aman, bukan NIS/nama.</AppText>
          </View>
        </View>
        {digitalCard.data?.token ? (
          <View style={[styles.qrWrapper, { backgroundColor: colors.bgSecondary }]}>
            <QRCode value={digitalCard.data.token} size={160} />
          </View>
        ) : null}
        <AppText variant="caption" style={styles.qrExpiry}>
          Berlaku sampai: {digitalCard.data?.expires_at || '-'}
        </AppText>
      </Card>

      {/* Recent Grades */}
      <AppText variant="subtitle" style={styles.sectionTitle}>📊 Nilai Terbaru</AppText>
      {grades.isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : (
        <FlatList
          scrollEnabled={false}
          data={gradeRows.slice(0, 5)}
          keyExtractor={(item, index) => String(item.id || index)}
          ListEmptyComponent={
            <EmptyState icon="📝" title="Belum ada nilai" />
          }
          renderItem={({ item }) => (
            <Card tone="white">
              <View style={styles.gradeRow}>
                <View style={[styles.gradeBadge, { backgroundColor: colors.primaryLight }]}>
                  <AppText style={[styles.gradeScore, { color: colors.primary }]}>{String(item.score ?? '-')}</AppText>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="subtitle">{String(item.title || '-')}</AppText>
                  <AppText variant="caption">{String(item.type || '-')}</AppText>
                </View>
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatarCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  avatarEmoji: {
    fontSize: 26,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  dateText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  qrHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  qrWrapper: {
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
  },
  qrExpiry: {
    textAlign: 'center',
  },
  sectionTitle: {
    marginTop: 4,
  },
  gradeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  gradeBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradeScore: {
    fontSize: 18,
    fontWeight: '800',
  },
});
