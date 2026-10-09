import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'splitsync_session_token';

export async function saveToken(token: string) {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, token);
    return;
  }
  await SecureStore.setItemAsync(KEY, token);
}

export async function getToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(KEY);
    return null;
  }
  return await SecureStore.getItemAsync(KEY);
}

export async function clearToken() {
  if (Platform.OS === 'web') {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(KEY);
    return;
  }
  await SecureStore.deleteItemAsync(KEY);
}
