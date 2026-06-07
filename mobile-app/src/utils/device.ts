import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomId } from './id';

const DEVICE_ID_KEY = 'edusmart.mobile.device_id';

export async function getOrCreateDeviceId(role: string, userId?: string | null): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const value = randomId(`mobile-${role}-${userId || 'user'}`);
  await AsyncStorage.setItem(DEVICE_ID_KEY, value);
  return value;
}
