import Constants from 'expo-constants';
import type { ApiEnvelope, AuthSession, TenantContext } from '@/types/mobile';

const defaultApiBaseUrl = String(Constants.expoConfig?.extra?.defaultApiBaseUrl || 'https://sismu.biz.id');

let currentSession: AuthSession | null = null;
let currentTenant: TenantContext | null = null;

export function setApiSession(session: AuthSession | null): void {
  currentSession = session;
  currentTenant = session?.tenant || currentTenant;
}

export function setApiTenant(tenant: TenantContext | null): void {
  currentTenant = tenant;
}

export function apiBaseUrl(): string {
  return (currentTenant?.apiBaseUrl || defaultApiBaseUrl).replace(/\/+$/, '');
}

type RequestOptions = RequestInit & {
  authenticated?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly payload: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isAuthApiError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  if (currentTenant?.slug) {
    headers.set('X-Tenant', currentTenant.slug);
  }
  if (options.authenticated !== false && currentSession?.token) {
    headers.set('Authorization', `Bearer ${currentSession.token}`);
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  const payload = await response.json().catch(() => ({})) as ApiEnvelope<T>;
  if (!response.ok) {
    throw new ApiError(
      payload.error || payload.message || `Server Error ${response.status}`,
      response.status,
      payload,
    );
  }

  return (payload.data ?? payload) as T;
}
