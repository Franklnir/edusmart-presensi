import { useCallback, useEffect, useMemo, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import {
  markFailed,
  markSynced,
  queuedScans,
  retryableQueuedScans,
  retryFailedScans,
} from '@/storage/offlineScanQueue';
import { syncRfidEvents } from '@/api/mobileApi';
import type { OfflineScanItem, RfidScanEvent } from '@/types/mobile';

export function useOfflineScanSync() {
  const [queueItems, setQueueItems] = useState<OfflineScanItem[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refreshSize = useCallback(async () => {
    setQueueItems(await queuedScans());
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    const events = await retryableQueuedScans();
    await refreshSize();
    if (events.length === 0) return;

    setSyncing(true);
    try {
      const response = await syncRfidEvents(events.map(toRfidEvent));
      const items = Array.isArray(response.items) ? response.items as Array<Record<string, unknown>> : [];
      const synced = items
        .filter(item => item.success === true || item.duplicate === true)
        .map(item => String(item.event_id || ''))
        .filter(Boolean);
      await markSynced(synced);

      for (const item of items.filter(item => item.success !== true && item.duplicate !== true)) {
        const eventId = String(item.event_id || '');
        if (!eventId) continue;

        await markFailed(
          eventId,
          String(item.message || item.reason || 'Gagal sync'),
          { permanent: isPermanentBackendFailure(item) },
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal sync offline';
      for (const event of events) {
        await markFailed(event.event_id, message);
      }
    } finally {
      setSyncing(false);
      await refreshSize();
    }
  }, [refreshSize, syncing]);

  const retryFailed = useCallback(async () => {
    await retryFailedScans();
    await refreshSize();
    await syncNow();
  }, [refreshSize, syncNow]);

  useEffect(() => {
    refreshSize();
    const unsub = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        syncNow().catch(() => undefined);
      }
    });
    return unsub;
  }, [refreshSize, syncNow]);

  const summary = useMemo(() => {
    const failedCount = queueItems.filter(item => item.status === 'failed' || item.failed_permanently).length;
    return {
      queueSize: queueItems.length,
      pendingCount: queueItems.length - failedCount,
      failedCount,
    };
  }, [queueItems]);

  return {
    ...summary,
    queueItems,
    syncing,
    syncNow,
    retryFailed,
    refreshSize,
  };
}

function toRfidEvent(item: OfflineScanItem): RfidScanEvent {
  const {
    queued_at,
    attempts,
    last_error,
    last_failed_at,
    status,
    failed_permanently,
    ...event
  } = item;

  return event;
}

function isPermanentBackendFailure(item: Record<string, unknown>): boolean {
  const status = Number(item.status || 0);
  const reason = String(item.reason || '').toLowerCase();

  if ([400, 401, 403, 404, 409, 422].includes(status)) return true;
  if (reason.includes('required') || reason.includes('invalid') || reason.includes('not_found')) return true;

  return false;
}
