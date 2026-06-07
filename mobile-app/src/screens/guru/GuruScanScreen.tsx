import React, { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';
import { useQuery } from '@tanstack/react-query';
import { fetchGuruClasses, postRfidScan } from '@/api/mobileApi';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { useOfflineScanSync } from '@/hooks/useOfflineScanSync';
import { useAuth } from '@/providers/AuthProvider';
import { enqueueScan } from '@/storage/offlineScanQueue';
import type { RfidScanEvent } from '@/types/mobile';
import { getOrCreateDeviceId } from '@/utils/device';
import { randomId } from '@/utils/id';
import { nowIsoJakarta } from '@/utils/time';

export function GuruScanScreen() {
  const { session } = useAuth();
  const classes = useQuery({ queryKey: ['guru-classes'], queryFn: fetchGuruClasses });
  const [selectedClass, setSelectedClass] = useState('');
  const [mode, setMode] = useState<'nfc' | 'qr' | 'manual'>('nfc');
  const [manualToken, setManualToken] = useState('');
  const [lastResults, setLastResults] = useState<Array<{ id: string; message: string; ok: boolean }>>([]);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const queue = useOfflineScanSync();

  const selectedContext = useMemo(() => {
    const row = (classes.data || []).find(item => String(item.kelas_id) === selectedClass);
    return {
      kelas_id: selectedClass || null,
      mapel: row ? String(row.mapel || '') : null,
    };
  }, [classes.data, selectedClass]);

  async function submitToken(token: string, source: RfidScanEvent['source']) {
    if (!session) return;
    if (!selectedClass) {
      Alert.alert('Pilih kelas dulu', 'Guru wajib memilih kelas sebelum scan.');
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
      setLastResults(items => [{
        id: event.event_id,
        ok,
        message: String(response.message || (ok ? 'Scan berhasil' : 'Scan diproses')),
      }, ...items].slice(0, 10));
    } catch (err) {
      await enqueueScan(event, err instanceof Error ? err.message : 'Internet putus');
      await queue.refreshSize();
      setLastResults(items => [{
        id: event.event_id,
        ok: false,
        message: 'Internet putus. Scan masuk antrean offline.',
      }, ...items].slice(0, 10));
    }
  }

  async function scanNfc() {
    setScanning(true);
    try {
      const supported = await NfcManager.isSupported();
      if (!supported) {
        setMode('qr');
        Alert.alert('NFC tidak tersedia', 'Gunakan QR sebagai fallback.');
        return;
      }
      await NfcManager.start();
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      const ndefRecord = tag?.ndefMessage?.[0];
      const payload = Array.isArray(ndefRecord?.payload)
        ? String.fromCharCode(...ndefRecord.payload.slice(3))
        : String(tag?.id || '');
      if (payload) await submitToken(payload, 'mobile-nfc');
    } catch (err) {
      Alert.alert('Scan NFC gagal', err instanceof Error ? err.message : 'Coba tempel kartu lagi.');
    } finally {
      await NfcManager.cancelTechnologyRequest().catch(() => undefined);
      setScanning(false);
    }
  }

  return (
    <Screen>
      <AppText variant="label">Absensi Guru</AppText>
      <AppText variant="title">Scan siswa</AppText>
      <Card tone="blue">
        <AppText variant="subtitle">Kelas</AppText>
        <FlatList
          horizontal
          data={classes.data || []}
          keyExtractor={(item, index) => String(item.kelas_id || index)}
          renderItem={({ item }) => (
            <Button
              tone={selectedClass === String(item.kelas_id) ? 'primary' : 'secondary'}
              label={`${String(item.kelas_id || '-')} / ${String(item.mapel || '-')}`}
              onPress={() => setSelectedClass(String(item.kelas_id || ''))}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ width: 8 }} />}
        />
      </Card>
      <Card>
        <View style={styles.modeRow}>
          <Button label="NFC" tone={mode === 'nfc' ? 'primary' : 'secondary'} onPress={() => setMode('nfc')} />
          <Button label="QR" tone={mode === 'qr' ? 'primary' : 'secondary'} onPress={async () => {
            if (!permission?.granted) await requestPermission();
            setMode('qr');
          }} />
          <Button label="Manual" tone={mode === 'manual' ? 'primary' : 'secondary'} onPress={() => setMode('manual')} />
        </View>
        {mode === 'nfc' ? <Button label="Mulai Scan NFC" loading={scanning} onPress={scanNfc} /> : null}
        {mode === 'qr' ? (
          permission?.granted ? (
            <CameraView
              style={styles.camera}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={({ data }) => submitToken(data, 'mobile-qr')}
            />
          ) : <Button label="Izinkan kamera" onPress={requestPermission} />
        ) : null}
        {mode === 'manual' ? (
          <>
            <TextInput placeholder="Token kartu / QR" value={manualToken} onChangeText={setManualToken} style={styles.input} autoCapitalize="none" />
            <Button label="Kirim Manual" disabled={!manualToken.trim()} onPress={() => {
              submitToken(manualToken, 'mobile-manual');
              setManualToken('');
            }} />
          </>
        ) : null}
      </Card>
      <Card tone={queue.queueSize > 0 ? 'yellow' : 'green'}>
        <AppText variant="subtitle">Antrean offline: {queue.queueSize}</AppText>
        <Button label="Sinkronkan sekarang" loading={queue.syncing} onPress={queue.syncNow} />
      </Card>
      <AppText variant="subtitle">Riwayat Scan</AppText>
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
  camera: {
    height: 280,
    borderRadius: 18,
    overflow: 'hidden',
  },
  input: {
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingHorizontal: 16,
    backgroundColor: '#ffffff',
  },
});
