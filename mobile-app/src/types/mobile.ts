export type MobileRole = 'guru' | 'siswa';

export type TenantContext = {
  id: string;
  slug: string;
  name: string;
  host?: string | null;
  apiBaseUrl: string;
  logoUrl?: string | null;
};

export type UserProfile = {
  id: string;
  nama?: string | null;
  email?: string | null;
  role: MobileRole;
  kelas?: string | null;
  nis?: string | null;
  photo_url?: string | null;
};

export type AuthSession = {
  token: string;
  tenant: TenantContext;
  profile: UserProfile;
};

export type RfidScanEvent = {
  event_id: string;
  tenant_slug: string;
  device_id: string;
  card_uid: string;
  mode: string;
  scanned_at: string;
  source: 'mobile-nfc' | 'mobile-qr' | 'mobile-manual';
  context?: Record<string, string | number | null>;
};

export type OfflineScanItem = RfidScanEvent & {
  queued_at: string;
  attempts: number;
  last_error?: string | null;
};

export type ApiEnvelope<T> = {
  data?: T;
  error?: string;
};
