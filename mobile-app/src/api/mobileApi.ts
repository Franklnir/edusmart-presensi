import type { AuthSession, RfidScanEvent, TenantContext, UserProfile } from '@/types/mobile';
import { apiRequest, setApiSession, setApiTenant } from './client';

type LoginResponse = {
  access_token: string;
  token_type: string;
  profile: UserProfile;
  user: { id: string; email: string };
};

export async function searchSchools(search: string): Promise<TenantContext[]> {
  const qs = encodeURIComponent(search);
  const rows = await apiRequest<Array<Record<string, string | null>>>(`/api/mobile/schools?search=${qs}&limit=12`, {
    authenticated: false,
  });

  return rows.map(row => ({
    id: String(row.id || row.tenant_id || ''),
    slug: String(row.slug || row.tenant_slug || ''),
    name: String(row.name || ''),
    host: row.host ? String(row.host) : null,
    apiBaseUrl: String(row.apiBaseUrl || row.api_base_url || ''),
    logoUrl: row.logoUrl ? String(row.logoUrl) : null,
  })).filter(row => row.id && row.slug && row.apiBaseUrl);
}

export async function loginMobile(tenant: TenantContext, identifier: string, password: string): Promise<AuthSession> {
  setApiTenant(tenant);
  const data = await apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    authenticated: false,
    headers: { 'X-Mobile-App': 'edusmart-presensi' },
    body: JSON.stringify({
      email: identifier,
      password,
      mobile: true,
    }),
  });

  const session: AuthSession = {
    token: data.access_token,
    tenant,
    profile: data.profile,
  };
  setApiSession(session);
  return session;
}

export async function logoutMobile(): Promise<{ ok: true }> {
  await apiRequest<unknown>('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
  return { ok: true };
}

export function fetchMe(): Promise<{ profile: UserProfile; tenant: TenantContext }> {
  return apiRequest('/api/mobile/me');
}

export function fetchDashboard(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/dashboard');
}

export function fetchGuruSchedulesToday(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/mobile/guru/schedules/today');
}

export function fetchGuruClasses(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/mobile/guru/classes');
}

export function fetchGuruClassDetail(classId: string): Promise<Record<string, unknown>> {
  return apiRequest(`/api/mobile/guru/classes/${encodeURIComponent(classId)}`);
}

export function fetchGuruAttendanceSummary(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/attendance/summary');
}

export function fetchSiswaAttendance(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/siswa/attendance');
}

export function fetchSiswaSchedules(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/mobile/siswa/schedules');
}

export function fetchSiswaTasks(): Promise<Array<Record<string, unknown>>> {
  return apiRequest('/api/mobile/siswa/tasks');
}

export function fetchSiswaGrades(): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/siswa/grades');
}

export function fetchDigitalCard(): Promise<{ token: string; expires_at: string; student: Record<string, unknown> }> {
  return apiRequest('/api/mobile/siswa/digital-card');
}

export function postRfidScan(event: RfidScanEvent): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/rfid/scan', {
    method: 'POST',
    body: JSON.stringify(event),
  });
}

export function syncRfidEvents(events: RfidScanEvent[]): Promise<Record<string, unknown>> {
  return apiRequest('/api/mobile/guru/rfid/sync', {
    method: 'POST',
    body: JSON.stringify({ events }),
  });
}
