import { setApiSession } from '@/api/client';
import { postRfidScan, syncRfidEvents } from '@/api/mobileApi';
import type { AuthSession, RfidScanEvent } from '@/types/mobile';

const session: AuthSession = {
  token: 'mobile-token',
  tenant: {
    id: 'tenant-1',
    slug: 'demo',
    name: 'Demo School',
    apiBaseUrl: 'https://demo.sismu.test',
  },
  profile: {
    id: 'guru-1',
    role: 'guru',
    nama: 'Guru Demo',
  },
};

const event: RfidScanEvent = {
  tenant_slug: 'demo',
  device_id: 'mobile-guru-1',
  event_id: 'event-1',
  card_uid: 'CARD-001',
  mode: 'auto',
  scanned_at: '2026-06-12T08:00:00+07:00',
  source: 'mobile-nfc',
};

beforeEach(() => {
  setApiSession(session);
  global.fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ success: true }),
  })) as never;
});

afterEach(() => {
  setApiSession(null);
  jest.restoreAllMocks();
});

it('uses authenticated mobile wrapper endpoint for guru RFID scan', async () => {
  await postRfidScan(event);

  const fetchMock = global.fetch as jest.Mock;
  expect(fetchMock).toHaveBeenCalledWith(
    'https://demo.sismu.test/api/mobile/guru/rfid/scan',
    expect.objectContaining({
      method: 'POST',
    })
  );

  const options = fetchMock.mock.calls[0][1];
  expect(options.body).toContain('"card_uid":"CARD-001"');
  expect(options.headers.get('Authorization')).toBe('Bearer mobile-token');
  expect(options.headers.get('X-Tenant')).toBe('demo');
});

it('uses authenticated mobile wrapper endpoint for queued RFID sync', async () => {
  await syncRfidEvents([event]);

  const fetchMock = global.fetch as jest.Mock;
  expect(fetchMock).toHaveBeenCalledWith(
    'https://demo.sismu.test/api/mobile/guru/rfid/sync',
    expect.objectContaining({
      method: 'POST',
    })
  );

  const options = fetchMock.mock.calls[0][1];
  expect(options.body).toContain('"events"');
  expect(options.headers.get('Authorization')).toBe('Bearer mobile-token');
});
