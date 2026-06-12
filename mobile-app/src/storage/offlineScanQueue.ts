import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineScanItem, RfidScanEvent } from '@/types/mobile';

const QUEUE_KEY = 'edusmart.mobile.offline_scan_queue';

export const OFFLINE_SCAN_MAX_QUEUE = 500;
export const OFFLINE_SCAN_MAX_RETRIES = 5;

async function readQueue(): Promise<OfflineScanItem[]> {
  const raw = await AsyncStorage.getItem(QUEUE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeQueueItem).filter(Boolean) as OfflineScanItem[] : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: OfflineScanItem[]): Promise<void> {
  await AsyncStorage.setItem(
    QUEUE_KEY,
    JSON.stringify(items.map(normalizeQueueItem).filter(Boolean).slice(-OFFLINE_SCAN_MAX_QUEUE)),
  );
}

export async function enqueueScan(event: RfidScanEvent, error?: string): Promise<void> {
  const queue = await readQueue();
  if (queue.some(item => item.event_id === event.event_id)) return;

  queue.push({
    ...event,
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: error || null,
    last_failed_at: error ? new Date().toISOString() : null,
    status: 'pending',
    failed_permanently: false,
  });
  await writeQueue(queue);
}

export async function queuedScans(): Promise<OfflineScanItem[]> {
  return readQueue();
}

export async function retryableQueuedScans(): Promise<OfflineScanItem[]> {
  const queue = await readQueue();
  return queue.filter(item => !isPermanentlyFailed(item));
}

export async function markSynced(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const ids = new Set(eventIds);
  const queue = await readQueue();
  await writeQueue(queue.filter(item => !ids.has(item.event_id)));
}

export async function markFailed(
  eventId: string,
  error: string,
  options: { permanent?: boolean } = {},
): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map(item => {
    if (item.event_id !== eventId) return item;

    const attempts = item.attempts + 1;
    const permanent = options.permanent === true || attempts >= OFFLINE_SCAN_MAX_RETRIES;
    return {
      ...item,
      attempts,
      last_error: error,
      last_failed_at: new Date().toISOString(),
      status: permanent ? 'failed' : 'pending',
      failed_permanently: permanent,
    };
  }));
}

export async function retryFailedScans(): Promise<void> {
  const queue = await readQueue();
  await writeQueue(queue.map(item => item.status === 'failed' || item.failed_permanently
    ? {
        ...item,
        attempts: 0,
        status: 'pending',
        failed_permanently: false,
        last_error: item.last_error || 'Menunggu retry manual',
      }
    : item));
}

export async function clearQueue(): Promise<void> {
  await AsyncStorage.removeItem(QUEUE_KEY);
}

function isPermanentlyFailed(item: OfflineScanItem): boolean {
  return item.failed_permanently === true
    || item.status === 'failed'
    || item.attempts >= OFFLINE_SCAN_MAX_RETRIES;
}

function normalizeQueueItem(value: unknown): OfflineScanItem | null {
  if (!value || typeof value !== 'object') return null;

  const item = value as Partial<OfflineScanItem>;
  if (!item.event_id || !item.card_uid) return null;

  const attempts = Number.isFinite(Number(item.attempts)) ? Math.max(0, Number(item.attempts)) : 0;
  const failed = item.failed_permanently === true || item.status === 'failed' || attempts >= OFFLINE_SCAN_MAX_RETRIES;

  return {
    ...(item as RfidScanEvent),
    event_id: String(item.event_id),
    card_uid: String(item.card_uid),
    tenant_slug: String(item.tenant_slug || ''),
    device_id: String(item.device_id || ''),
    mode: String(item.mode || 'auto'),
    scanned_at: String(item.scanned_at || new Date().toISOString()),
    source: item.source || 'mobile-nfc',
    queued_at: String(item.queued_at || new Date().toISOString()),
    attempts,
    last_error: item.last_error ?? null,
    last_failed_at: item.last_failed_at ?? null,
    status: failed ? 'failed' : 'pending',
    failed_permanently: failed,
  };
}
