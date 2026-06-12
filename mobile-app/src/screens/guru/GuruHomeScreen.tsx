import React, { useEffect, useRef } from 'react';
import { Animated, FlatList, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { fetchDashboard, fetchGuruSchedulesToday } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { SkeletonCard, SkeletonStatGrid } from '@/components/Skeleton';
import { StatGrid } from '@/components/StatGrid';
import { useAuth } from '@/providers/AuthProvider';
import { useColors } from '@/providers/ThemeProvider';
import { formatShortDate, greetingLabel } from '@/utils/time';

export function GuruHomeScreen() {
  const { session } = useAuth();
  const colors = useColors();
  const dashboard = useQuery({ queryKey: ['guru-dashboard'], queryFn: fetchDashboard });
  const schedules = useQuery({ queryKey: ['guru-schedules-today'], queryFn: fetchGuruSchedulesToday });
  const summary = dashboard.data?.summary as Record<string, number> | undefined;
  const isLoading = dashboard.isLoading;

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, [headerAnim]);

  const handleRefresh = () => {
    dashboard.refetch();
    schedules.refetch();
  };

  return (
    <Screen
      refreshing={dashboard.isFetching || schedules.isFetching}
      onRefresh={handleRefresh}
    >
      {/* Greeting Header */}
      <Animated.View style={[styles.header, { opacity: headerAnim }]}>
        <View style={[styles.avatarCircle, { backgroundColor: colors.primaryLight }]}>
          <AppText style={styles.avatarEmoji}>👨‍🏫</AppText>
        </View>
        <View style={styles.headerText}>
          <AppText variant="caption">{session?.tenant.name}</AppText>
          <AppText variant="title">{greetingLabel()},</AppText>
          <AppText variant="subtitle">{session?.profile.nama || 'Guru'}</AppText>
        </View>
      </Animated.View>

      <Card tone="indigo" animated={false}>
        <AppText style={[styles.dateText, { color: colors.primary }]}>📅 {formatShortDate()}</AppText>
      </Card>

      {/* Stats */}
      {isLoading ? <SkeletonStatGrid /> : (
        <StatGrid items={[
          { label: 'Kelas hari ini', value: summary?.today_classes ?? 0, tone: 'blue' },
          { label: 'Absensi selesai', value: `${summary?.attendance_done ?? 0}/${summary?.today_classes ?? 0}`, tone: 'green' },
          { label: 'Belum absen', value: summary?.missing_attendance ?? 0, tone: 'yellow' },
          { label: 'Queue offline', value: summary?.offline_queue ?? 0, tone: 'white' },
        ]} />
      )}

      {/* Schedule */}
      <AppText variant="subtitle" style={styles.sectionTitle}>📋 Jadwal Hari Ini</AppText>
      {schedules.isLoading ? (
        <>
          <SkeletonCard />
          <SkeletonCard />
        </>
      ) : (
        <FlatList
          data={schedules.data || []}
          scrollEnabled={false}
          keyExtractor={(item, index) => String(item.id || index)}
          ListEmptyComponent={
            <EmptyState icon="🎉" title="Tidak ada jadwal hari ini" />
          }
          renderItem={({ item }) => (
            <Card tone="white">
              <View style={styles.scheduleRow}>
                <View style={styles.scheduleTime}>
                  <AppText variant="caption">Mulai</AppText>
                  <AppText variant="subtitle">{String(item.jam_mulai || '-')}</AppText>
                  <AppText variant="caption">{String(item.jam_selesai || '')}</AppText>
                </View>
                <View style={[styles.scheduleDivider, { backgroundColor: colors.primary + '60' }]} />
                <View style={styles.scheduleInfo}>
                  <AppText variant="subtitle">{String(item.mapel || '-')}</AppText>
                  <AppText>Kelas: {String(item.kelas_id || '-')}</AppText>
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
  sectionTitle: {
    marginTop: 4,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  scheduleTime: {
    width: 70,
    alignItems: 'center',
    gap: 2,
  },
  scheduleDivider: {
    width: 3,
    height: 40,
    borderRadius: 2,
  },
  scheduleInfo: {
    flex: 1,
    gap: 4,
  },
});
