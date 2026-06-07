import { useCallback, useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { markFailed, markSynced, queuedScans } from '@/storage/offlineScanQueue';
import { syncRfidEvents } from '@/api/mobileApi';

export function useOfflineScanSync() {
  const [queueSize, setQueueSize] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshSize = useCallback(async () => {
    setQueueSize((await queuedScans()).length);
  }, []);

  const syncNow = useCallback(async () => {
    if (syncing) return;
    const events = await queuedScans();
    setQueueSize(events.length);
    if (events.length === 0) return;

    setSyncing(true);
    try {
      const response = await syncRfidEvents(events.map(({ queued_at, attempts, last_error, ...event }) => event));
      const items = Array.isArray(response.items) ? response.items as Array<Record<string, unknown>> : [];
      const synced = items
        .filter(item => item.success === true || item.duplicate === true)
        .map(item => String(item.event_id || ''))
        .filter(Boolean);
      await markSynced(synced);
      for (const item of items.filter(item => item.success !== true && item.duplicate !== true)) {
        const eventId = String(item.event_id || '');
        if (eventId) await markFailed(eventId, String(item.message || item.reason || 'Gagal sync'));
      }
    } finally {
      setSyncing(false);
      await refreshSize();
    }
  }, [refreshSize, syncing]);

  useEffect(() => {
    refreshSize();
    const unsub = NetInfo.addEventListener(state => {
      if (state.isConnected) {
        syncNow().catch(() => undefined);
      }
    });
    return unsub;
  }, [refreshSize, syncNow]);

  return { queueSize, syncing, syncNow, refreshSize };
}
