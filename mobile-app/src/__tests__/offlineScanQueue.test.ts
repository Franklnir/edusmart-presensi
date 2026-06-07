import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueScan, queuedScans, markSynced } from '@/storage/offlineScanQueue';

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
