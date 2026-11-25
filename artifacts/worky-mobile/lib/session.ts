import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Account } from '@workspace/api-client-react';

const TOKEN_KEY = 'worky-mobile-session';
const SAVED_ACCOUNTS_KEY = 'worky-mobile-saved-accounts';
const DEVICE_ID_KEY = 'worky-mobile-device-id';

export type SavedAccount = Pick<Account, 'id' | 'nombre' | 'email' | 'rol' | 'fotoObjectPath' | 'username'>;
type StoredAccountSession = {
  token: string;
  account: SavedAccount;
};

export const getStoredToken = () => AsyncStorage.getItem(TOKEN_KEY);

async function getStoredAccountSessions(): Promise<StoredAccountSession[]> {
  try {
    const value = await AsyncStorage.getItem(SAVED_ACCOUNTS_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((session): session is StoredAccountSession =>
      Boolean(
        session &&
        typeof session === 'object' &&
        typeof (session as StoredAccountSession).token === 'string' &&
        (session as StoredAccountSession).account &&
        typeof (session as StoredAccountSession).account.id === 'number' &&
        typeof (session as StoredAccountSession).account.email === 'string',
      ),
    );
  } catch {
    return [];
  }
}

function accountSummary(account: Account): SavedAccount {
  return {
    id: account.id,
    nombre: account.nombre,
    email: account.email,
    rol: account.rol,
    fotoObjectPath: account.fotoObjectPath ?? null,
    username: account.username ?? null,
  };
}

export async function getSavedAccounts(): Promise<SavedAccount[]> {
  const sessions = await getStoredAccountSessions();
  return sessions.map(({ account }) => account);
}

export async function storeToken(token: string, account: Account) {
  const sessions = await getStoredAccountSessions();
  const summary = accountSummary(account);
  const next = [
    { token, account: summary },
    ...sessions.filter(({ account: saved }) => saved.id !== account.id),
  ];
  await AsyncStorage.multiSet([
    [TOKEN_KEY, token],
    [SAVED_ACCOUNTS_KEY, JSON.stringify(next)],
  ]);
}

export async function getSavedAccountToken(accountId: number) {
  const sessions = await getStoredAccountSessions();
  return sessions.find(({ account }) => account.id === accountId)?.token ?? null;
}

export async function activateStoredToken(token: string) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function updateStoredAccount(account: Account) {
  const token = await getStoredToken();
  if (!token) return;
  const sessions = await getStoredAccountSessions();
  const summary = accountSummary(account);
  const updated = sessions.map((session) =>
    session.token === token ? { ...session, account: summary } : session,
  );
  if (!updated.some((session) => session.token === token)) {
    updated.unshift({ token, account: summary });
  }
  await AsyncStorage.setItem(SAVED_ACCOUNTS_KEY, JSON.stringify(updated));
}

export async function removeStoredAccountByToken(token: string) {
  const sessions = await getStoredAccountSessions();
  await AsyncStorage.setItem(
    SAVED_ACCOUNTS_KEY,
    JSON.stringify(sessions.filter((session) => session.token !== token)),
  );
}

export async function clearStoredToken() {
  const token = await getStoredToken();
  if (token) await removeStoredAccountByToken(token);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function getOrCreateDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = Array.from({ length: 4 }, () =>
    Math.random().toString(36).slice(2).padEnd(10, '0'),
  ).join('');
  await AsyncStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
}
