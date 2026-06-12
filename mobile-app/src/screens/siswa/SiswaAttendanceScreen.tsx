import React, { useCallback, useState } from 'react';
import { Alert, FlatList, StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery } from '@tanstack/react-query';
import { fetchSiswaAttendance, fetchSiswaSchedules, postAttendanceQrScan } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { SkeletonStatGrid } from '@/components/Skeleton';
import { StatGrid } from '@/components/StatGrid';
import { hapticError, hapticSuccess } from '@/utils/haptics';

export function SiswaAttendanceScreen() {
  const attendance = useQuery({ queryKey: ['siswa-attendance'], queryFn: fetchSiswaAttendance });
  const schedules = useQuery({ queryKey: ['siswa-schedules'], queryFn: fetchSiswaSchedules });
  const summary = attendance.data?.summary as Record<string, number> | undefined;

  const [showScanner, setShowScanner] = useState(false);
  const [qrLocked, setQrLocked] = useState(false);
  const [scanResult, setScanResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [permission, requestPermission] = useCameraPermissions();

  const handleBarcodeScan = useCallback(async ({ data }: { data: string }) => {
    if (qrLocked || !data) return;
    setQrLocked(true);

    try {
      const result = await postAttendanceQrScan(data);
      const ok = result.success === true;
      if (ok) hapticSuccess(); else hapticError();
      setScanResult({
        ok,
        message: ok
          ? `✅ Absensi berhasil! ${result.mapel || ''} - ${result.jam_absensi || ''}`
          : String(result.error || result.reason || 'Gagal scan QR'),
      });
      if (ok) setShowScanner(false);
    } catch (err) {
      hapticError();
      setScanResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Gagal scan QR absensi',
      });
    } finally {
      setTimeout(() => setQrLocked(false), 2000);
    }
  }, [qrLocked]);

  const openScanner = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert('Izin Kamera', 'Izin kamera diperlukan untuk scan QR absensi.');
        return;
      }
    }
    setScanResult(null);
    setShowScanner(true);
  };

  const handleRefresh = () => {
    attendance.refetch();
    schedules.refetch();
  };

  return (
    <Screen refreshing={attendance.isFetching || schedules.isFetching} onRefresh={handleRefresh}>
      <AppText variant="label">Siswa</AppText>
      <AppText variant="title">✅ Absensi saya</AppText>

      {/* Scan QR Button */}
      <Button label="📷 Scan QR Absensi" icon="📸" onPress={openScanner} />

      {/* QR Scanner */}
      {showScanner ? (
        <Card>
          <AppText variant="subtitle">Arahkan kamera ke QR guru</AppText>
          <CameraView
            style={styles.camera}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcodeScan}
          />
          <Button label="Tutup Scanner" tone="secondary" onPress={() => setShowScanner(false)} />
        </Card>
      ) : null}

      {/* Scan Result */}
      {scanResult ? (
        <Card tone={scanResult.ok ? 'green' : 'rose'}>
          <AppText variant="subtitle">{scanResult.ok ? '🎉 Berhasil!' : '⚠️ Perhatian'}</AppText>
          <AppText>{scanResult.message}</AppText>
        </Card>
      ) : null}

      {/* Attendance Summary */}
      {attendance.isLoading ? <SkeletonStatGrid /> : (
        <StatGrid items={[
          { label: 'Hadir', value: summary?.hadir ?? 0, tone: 'green' },
          { label: 'Izin', value: summary?.izin ?? 0, tone: 'yellow' },
          { label: 'Sakit', value: summary?.sakit ?? 0, tone: 'blue' },
          { label: 'Alpha', value: summary?.alpha ?? 0, tone: 'rose' },
        ]} />
      )}

      {/* Schedule */}
      <AppText variant="subtitle">📋 Jadwal</AppText>
      <FlatList
        scrollEnabled={false}
        data={schedules.data || []}
        keyExtractor={(item, index) => String(item.id || index)}
        ListEmptyComponent={
          <EmptyState
            icon={schedules.isLoading ? '⏳' : '📚'}
            title={schedules.isLoading ? 'Memuat jadwal...' : 'Tidak ada jadwal'}
          />
        }
        renderItem={({ item }) => (
          <Card>
            <AppText variant="subtitle">{String(item.mapel || '-')}</AppText>
            <AppText>{String(item.hari || '-')} — {String(item.jam_mulai || '')} s/d {String(item.jam_selesai || '')}</AppText>
          </Card>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  camera: {
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
    marginVertical: 8,
  },
});
