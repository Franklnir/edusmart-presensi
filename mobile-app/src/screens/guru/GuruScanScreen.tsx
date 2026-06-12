import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import QRCode from 'react-native-qrcode-svg';
import { useQuery } from '@tanstack/react-query';
import {
  fetchGuruClassDetail,
  fetchGuruSchedulesToday,
  postAttendanceQrSession,
  postManualAttendance,
  postRfidScan,
} from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Screen } from '@/components/Screen';
import { useOfflineScanSync } from '@/hooks/useOfflineScanSync';
import { useAuth } from '@/providers/AuthProvider';
import { enqueueScan } from '@/storage/offlineScanQueue';
import { parseNfcTag } from '@/features/attendance/nfc/nfcParser';
import { hapticError, hapticSuccess } from '@/utils/haptics';
import type { ManualAttendancePayload, RfidScanEvent, ScheduleItem, StudentListItem } from '@/types/mobile';
import { getOrCreateDeviceId } from '@/utils/device';
import { randomId } from '@/utils/id';
import { nowIsoJakarta } from '@/utils/time';

type ScanMode = 'nfc' | 'qr-kelas' | 'manual';
type AttendanceStatus = 'Hadir' | 'Izin' | 'Sakit' | 'Alpha';

const STATUS_OPTIONS: AttendanceStatus[] = ['Hadir', 'Izin', 'Sakit', 'Alpha'];
const STATUS_COLORS: Record<AttendanceStatus, string> = {
  Hadir: '#22c55e',
  Izin: '#eab308',
  Sakit: '#3b82f6',
  Alpha: '#ef4444',
};

const NFC_TECHS = Platform.OS === 'ios'
  ? [NfcTech.Ndef, NfcTech.NfcA, NfcTech.NfcV]
  : [
      NfcTech.Ndef,
      NfcTech.NfcA,
      NfcTech.NfcB,
      NfcTech.NfcF,
      NfcTech.NfcV,
      NfcTech.IsoDep,
      NfcTech.MifareClassic,
      NfcTech.MifareUltralight,
    ];

export function GuruScanScreen() {
  const { session } = useAuth();
  const schedules = useQuery({ queryKey: ['guru-schedules-today'], queryFn: fetchGuruSchedulesToday });
  const [selectedSchedule, setSelectedSchedule] = useState<ScheduleItem | null>(null);
  const [mode, setMode] = useState<ScanMode>('nfc');
  const [lastResults, setLastResults] = useState<Array<{ id: string; message: string; ok: boolean }>>([]);
  const [scanning, setScanning] = useState(false);
  const [scanLocked, setScanLocked] = useState(false);
  const queue = useOfflineScanSync();

  // QR Kelas state
  const [qrToken, setQrToken] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const qrTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manual attendance state
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentListItem | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<AttendanceStatus>('Hadir');
  const [manualSubmitting, setManualSubmitting] = useState(false);

  const selectedContext = useMemo(() => {
    if (!selectedSchedule) return { kelas_id: null, mapel: null, jadwal_id: null };
    return {
      kelas_id: selectedSchedule.kelas_id || null,
      mapel: selectedSchedule.mapel || null,
      jadwal_id: selectedSchedule.id || null,
    };
  }, [selectedSchedule]);

  // Cleanup QR refresh timer
  useEffect(() => {
    return () => {
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
    };
  }, []);

  // Load students when switching to manual mode and a schedule is selected
  useEffect(() => {
    if (mode === 'manual' && selectedSchedule?.kelas_id) {
      setStudentsLoading(true);
      setSelectedStudent(null);
      fetchGuruClassDetail(selectedSchedule.kelas_id)
        .then(data => setStudents(data.students || []))
        .catch(() => setStudents([]))
        .finally(() => setStudentsLoading(false));
    }
  }, [mode, selectedSchedule?.kelas_id]);

  // ── NFC Scan ──
  async function submitToken(token: string, source: RfidScanEvent['source']) {
    if (!session) return;
    if (!selectedSchedule) {
      Alert.alert('Pilih jadwal dulu', 'Guru wajib memilih jadwal sebelum scan.');
      return;
    }

    const event: RfidScanEvent = {
      tenant_slug: session.tenant.slug,
      device_id: await getOrCreateDeviceId('guru', session.profile.id),
      event_id: randomId(`mobile-${source}`),
      card_uid: token.trim(),
      mode: 'auto',
      scanned_at: nowIsoJakarta(),
      source,
      context: selectedContext,
    };

    try {
      const response = await postRfidScan(event);
      const ok = response.success === true || response.status === 'success';
      if (ok) hapticSuccess(); else hapticError();
      addResult(event.event_id, ok, String(response.message || (ok ? 'Scan berhasil' : 'Scan diproses')));
    } catch (err) {
      await enqueueScan(event, err instanceof Error ? err.message : 'Internet putus');
      await queue.refreshSize();
      hapticError();
      addResult(event.event_id, false, 'Internet putus. Scan masuk antrean offline.');
    }
  }

  async function scanNfc() {
    if (scanLocked) return;
    setScanLocked(true);
    setScanning(true);
    try {
      const supported = await NfcManager.isSupported();
      if (!supported) {
        setMode('qr-kelas');
        Alert.alert('NFC tidak tersedia', 'Gunakan mode lain sebagai fallback.');
        return;
      }
      await NfcManager.start();
      await NfcManager.requestTechnology(NFC_TECHS);
      const tag = await NfcManager.getTag();
      const parsed = parseNfcTag(tag as Parameters<typeof parseNfcTag>[0]);
      if (parsed.value) {
        await submitToken(parsed.value, 'mobile-nfc');
      } else {
        Alert.alert('Kartu tidak terbaca', 'Tidak dapat membaca data dari kartu NFC ini.');
      }
    } catch (err) {
      Alert.alert('Scan NFC gagal', err instanceof Error ? err.message : 'Coba tempel kartu lagi.');
    } finally {
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
      setScanning(false);
      setTimeout(() => setScanLocked(false), 1500);
    }
  }

  // ── QR Kelas (Guru tampilkan QR → Siswa scan) ──
  const generateQrSession = useCallback(async () => {
    if (!selectedSchedule) {
      Alert.alert('Pilih jadwal dulu', 'Pilih jadwal untuk membuat QR absensi kelas.');
      return;
    }
    setQrLoading(true);
    try {
      const result = await postAttendanceQrSession(selectedSchedule.id, selectedSchedule.kelas_id);
      setQrToken(result.token);
      // Auto-refresh after refresh_after_seconds
      if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
      const refreshMs = (result.refresh_after_seconds || 45) * 1000;
      qrTimerRef.current = setTimeout(() => generateQrSession(), refreshMs);
    } catch (err) {
      Alert.alert('Gagal membuat QR', err instanceof Error ? err.message : 'Coba lagi.');
      setQrToken(null);
    } finally {
      setQrLoading(false);
    }
  }, [selectedSchedule]);

  // ── Manual Attendance ──
  async function submitManualAttendance() {
    if (!selectedSchedule || !selectedStudent) return;
    setManualSubmitting(true);
    try {
      const payload: ManualAttendancePayload = {
        jadwal_id: selectedSchedule.id,
        kelas_id: selectedSchedule.kelas_id,
        siswa_id: selectedStudent.id,
        status: selectedStatus,
      };
      const response = await postManualAttendance(payload);
      const ok = (response as Record<string, unknown>).success === true;
      if (ok) hapticSuccess(); else hapticError();
      addResult(
        randomId('manual'),
        ok,
        ok
          ? `${selectedStudent.nama} → ${selectedStatus}`
          : String((response as Record<string, unknown>).error || 'Gagal'),
      );
      setSelectedStudent(null);
    } catch (err) {
      addResult(randomId('manual'), false, err instanceof Error ? err.message : 'Gagal simpan absensi manual.');
    } finally {
      setManualSubmitting(false);
    }
  }

  function addResult(id: string, ok: boolean, message: string) {
    setLastResults(items => [{ id, ok, message }, ...items].slice(0, 10));
  }

  return (
    <Screen>
      <AppText variant="label">Absensi Guru</AppText>
      <AppText variant="title">Absensi Kelas</AppText>

      {/* ── Pilih Jadwal ── */}
      <Card tone="blue">
        <AppText variant="subtitle">Jadwal Hari Ini</AppText>
        <FlatList
          horizontal
          data={schedules.data || []}
          keyExtractor={(item, index) => String(item.id || index)}
          ListEmptyComponent={
            <AppText>{schedules.isLoading ? 'Memuat jadwal...' : 'Tidak ada jadwal hari ini'}</AppText>
          }
          renderItem={({ item }) => (
            <Button
              tone={selectedSchedule?.id === item.id ? 'primary' : 'secondary'}
              label={`${String(item.kelas_id || '-')} / ${String(item.mapel || '-')}`}
              onPress={() => {
                setSelectedSchedule(item);
                setQrToken(null);
                if (qrTimerRef.current) clearTimeout(qrTimerRef.current);
              }}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
        />
      </Card>

      {/* ── Mode Selector ── */}
      <Card>
        <View style={styles.modeRow}>
          <Button label="NFC" tone={mode === 'nfc' ? 'primary' : 'secondary'} onPress={() => setMode('nfc')} />
          <Button label="QR Kelas" tone={mode === 'qr-kelas' ? 'primary' : 'secondary'} onPress={() => setMode('qr-kelas')} />
          <Button label="Manual" tone={mode === 'manual' ? 'primary' : 'secondary'} onPress={() => setMode('manual')} />
        </View>

        {/* ── NFC Mode ── */}
        {mode === 'nfc' ? (
          <Button label="Mulai Scan NFC" loading={scanning} onPress={scanNfc} />
        ) : null}

        {/* ── QR Kelas Mode (Guru tampilkan QR, siswa scan) ── */}
        {mode === 'qr-kelas' ? (
          <View style={styles.qrContainer}>
            {!selectedSchedule ? (
              <AppText>Pilih jadwal di atas untuk menampilkan QR.</AppText>
            ) : qrToken ? (
              <>
                <AppText variant="subtitle">
                  QR Absensi: {selectedSchedule.kelas_id} / {selectedSchedule.mapel}
                </AppText>
                <View style={styles.qrCode}>
                  <QRCode value={qrToken} size={220} />
                </View>
                <AppText variant="caption">QR otomatis diperbarui setiap 45 detik</AppText>
                <Button label="Refresh QR" onPress={generateQrSession} loading={qrLoading} />
              </>
            ) : (
              <Button label="Tampilkan QR Absensi" onPress={generateQrSession} loading={qrLoading} />
            )}
          </View>
        ) : null}

        {/* ── Manual Mode (Pilih siswa + status) ── */}
        {mode === 'manual' ? (
          <View>
            {!selectedSchedule ? (
              <AppText>Pilih jadwal di atas terlebih dahulu.</AppText>
            ) : studentsLoading ? (
              <AppText>Memuat daftar siswa...</AppText>
            ) : selectedStudent ? (
              <Card tone="blue">
                <AppText variant="subtitle">Siswa: {selectedStudent.nama}</AppText>
                <AppText>NIS: {selectedStudent.nis || '-'}</AppText>
                <AppText variant="subtitle" style={{ marginTop: 8 }}>Pilih Status:</AppText>
                <View style={styles.statusRow}>
                  {STATUS_OPTIONS.map(status => (
                    <TouchableOpacity
                      key={status}
                      style={[
                        styles.statusChip,
                        { backgroundColor: selectedStatus === status ? STATUS_COLORS[status] : '#e2e8f0' },
                      ]}
                      onPress={() => setSelectedStatus(status)}
                    >
                      <AppText style={{ color: selectedStatus === status ? '#fff' : '#1e293b', fontWeight: '700' }}>
                        {status}
                      </AppText>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.manualActions}>
                  <Button label="Batal" tone="secondary" onPress={() => setSelectedStudent(null)} />
                  <Button label="Simpan" loading={manualSubmitting} onPress={submitManualAttendance} />
                </View>
              </Card>
            ) : (
              <>
                <AppText variant="subtitle">Pilih Siswa ({students.length})</AppText>
                <FlatList
                  data={students}
                  keyExtractor={item => item.id}
                  scrollEnabled={false}
                  ListEmptyComponent={<EmptyState title="Tidak ada siswa di kelas ini" />}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.studentRow} onPress={() => setSelectedStudent(item)}>
                      <AppText style={{ fontWeight: '600' }}>{item.nama}</AppText>
                      <AppText variant="caption">{item.nis || '-'}</AppText>
                    </TouchableOpacity>
                  )}
                />
              </>
            )}
          </View>
        ) : null}
      </Card>

      {/* ── Offline Queue ── */}
      <Card tone={queue.queueSize > 0 ? 'yellow' : 'green'}>
        <AppText variant="subtitle">Antrean offline: {queue.pendingCount}</AppText>
        {queue.failedCount > 0 ? (
          <AppText variant="caption">{queue.failedCount} scan gagal permanen. Cek alasan lalu retry manual jika perlu.</AppText>
        ) : null}
        <View style={styles.manualActions}>
          <Button label="Sinkronkan sekarang" loading={queue.syncing} onPress={queue.syncNow} />
          {queue.failedCount > 0 ? (
            <Button label="Retry gagal" tone="secondary" loading={queue.syncing} onPress={queue.retryFailed} />
          ) : null}
        </View>
        {queue.queueItems.slice(0, 5).map(item => (
          <View key={item.event_id} style={styles.queueItem}>
            <AppText variant="caption">
              {item.card_uid} - {item.status === 'failed' ? 'gagal' : 'pending'} - retry {item.attempts}
            </AppText>
            {item.last_error ? <AppText variant="caption">{item.last_error}</AppText> : null}
          </View>
        ))}
      </Card>

      {/* ── Riwayat ── */}
      <AppText variant="subtitle">Riwayat</AppText>
      {lastResults.map(item => (
        <Card key={item.id} tone={item.ok ? 'green' : 'yellow'}>
          <AppText variant="subtitle">{item.ok ? 'Berhasil' : 'Perhatian'}</AppText>
          <AppText>{item.message}</AppText>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  qrContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  qrCode: {
    padding: 16,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    alignItems: 'center',
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 8,
  },
  statusChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
  manualActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  studentRow: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  queueItem: {
    borderTopWidth: 1,
    borderTopColor: '#fde68a',
    paddingTop: 8,
    gap: 4,
  },
});
