import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OFFLINE_SCAN_MAX_RETRIES,
  enqueueScan,
  markFailed,
  markSynced,
  queuedScans,
  retryFailedScans,
  retryableQueuedScans,
} from '@/storage/offlineScanQueue';

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => store.get(key) || null);
  (AsyncStorage.setItem as jest.Mock).mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(async (key: string) => {
    store.delete(key);
  });
});

it('keeps scan events idempotent by event_id', async () => {
  const event = {
    tenant_slug: 'demo',
    device_id: 'mobile-guru-1',
    event_id: 'event-1',
    card_uid: 'token',
    mode: 'auto',
    scanned_at: new Date().toISOString(),
    source: 'mobile-nfc' as const,
  };

  await enqueueScan(event);
  await enqueueScan(event);

  expect(await queuedScans()).toHaveLength(1);

  await markSynced(['event-1']);

  expect(await queuedScans()).toHaveLength(0);
});

it('marks queue items as permanently failed after max retries', async () => {
  const event = {
    tenant_slug: 'demo',
    device_id: 'mobile-guru-1',
    event_id: 'event-2',
    card_uid: 'token',
    mode: 'auto',
    scanned_at: new Date().toISOString(),
    source: 'mobile-nfc' as const,
  };

  await enqueueScan(event);
  for (let index = 0; index < OFFLINE_SCAN_MAX_RETRIES; index += 1) {
    await markFailed('event-2', 'Kartu tidak valid');
  }

  const [item] = await queuedScans();
  expect(item.status).toBe('failed');
  expect(item.failed_permanently).toBe(true);
  expect(await retryableQueuedScans()).toHaveLength(0);

  await retryFailedScans();
  const [retried] = await queuedScans();
  expect(retried.status).toBe('pending');
  expect(retried.attempts).toBe(0);
  expect(await retryableQueuedScans()).toHaveLength(1);
});
