import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { AuthSession, TenantContext, UserProfile } from '@/types/mobile';

const TOKEN_KEY = 'edusmart.mobile.token';
const TENANT_KEY = 'edusmart.mobile.tenant';
const PROFILE_KEY = 'edusmart.mobile.profile';

export async function saveTenant(tenant: TenantContext): Promise<void> {
  await AsyncStorage.setItem(TENANT_KEY, JSON.stringify(tenant));
}

export async function loadTenant(): Promise<TenantContext | null> {
  const raw = await AsyncStorage.getItem(TENANT_KEY);
  return raw ? JSON.parse(raw) as TenantContext : null;
}

export async function saveSession(session: AuthSession): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, session.token);
  await saveTenant(session.tenant);
  await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(session.profile));
}

export async function loadSession(): Promise<AuthSession | null> {
  const [token, tenantRaw, profileRaw] = await Promise.all([
    SecureStore.getItemAsync(TOKEN_KEY),
    AsyncStorage.getItem(TENANT_KEY),
    AsyncStorage.getItem(PROFILE_KEY),
  ]);

  if (!token || !tenantRaw || !profileRaw) return null;

  return {
    token,
    tenant: JSON.parse(tenantRaw) as TenantContext,
    profile: JSON.parse(profileRaw) as UserProfile,
  };
}

export async function clearSession(keepTenant = true): Promise<void> {
  const tenant = keepTenant ? await loadTenant() : null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await AsyncStorage.removeItem(PROFILE_KEY);
  if (!keepTenant) {
    await AsyncStorage.removeItem(TENANT_KEY);
  } else if (tenant) {
    await saveTenant(tenant);
  }
}
