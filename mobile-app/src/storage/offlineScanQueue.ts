import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineScanItem, RfidScanEvent } from '@/types/mobile';

const QUEUE_KEY = 'edusmart.mobile.offline_scan_queue';
const MAX_QUEUE = 500;

async function readQueue(): Promise<OfflineScanItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  return raw ? JSON.parse(raw) as OfflineScanItem[] : [];
}

async function writeQueue(items: OfflineScanItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-MAX_QUEUE)));
}

export async function enqueueScan(event: RfidScanEvent, error?: string): Promise<void> {
  const queue = await readQueue();
  if (queue.some(item => item.event_id === event.event_id)) return;
  queue.push({
    ...event,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: error || null,
  });
  await writeQueue(queue);
}

export async function queuedScans(): Promise<OfflineScanItem[]> {
  return readQueue();
}

export async function markSynced(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const ids = new Set(eventIds);
  const queue = await readQueue();
  await writeQueue(queue.filter(item => !ids.has(item.event_id)));
}

export async function markFailed(eventId: string, error: string): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map(item => item.event_id === eventId
    ? { ...item, attempts: item.attempts + 1, last_error: error }
    : item));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}
