import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getMyAccount,
  confirmRegistrationEmailVerification,
  confirmMobileDeviceLogin,
  logoutAccount,
  requestMobileDeviceLogin,
  requestRegistrationEmailVerification,
  registerAccount,
  switchAccountRole,
  type Account,
  type AuthRegisterInput,
} from '@workspace/api-client-react';
import {
  activateStoredToken,
  clearStoredToken,
  getSavedAccountToken,
  getSavedAccounts as readSavedAccounts,
  getStoredToken,
  removeStoredAccountByToken,
  storeToken,
  updateStoredAccount,
  type SavedAccount,
} from '@/lib/session';
import { getSessionValidationStatus, loadAccountWithRetry } from '@/lib/session-validation';
import { switchRoleAfterServerConfirmation, type WorkyRole } from '@/lib/role-switch';

type SessionState = 'loading' | 'signed-in' | 'signed-out' | 'error';

interface AuthContextValue {
  account: Account | null;
  savedAccounts: SavedAccount[];
  state: SessionState;
  signIn: (email: string, password: string, deviceId: string) => Promise<{ challengeId?: number }>;
  confirmDeviceLogin: (email: string, deviceId: string, challengeId: number, code: string) => Promise<void>;
  signUp: (input: AuthRegisterInput) => Promise<void>;
  requestRegistrationCode: (email: string) => Promise<void>;
  confirmRegistrationCode: (email: string, code: string) => Promise<Account>;
  signOut: () => Promise<void>;
  switchSavedAccount: (accountId: number) => Promise<Account>;
  switchRole: (role: WorkyRole) => Promise<Account>;
  refreshSession: () => Promise<void>;
  setAccount: (account: Account) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<Account | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [state, setState] = useState<SessionState>('loading');

  const refreshSavedAccounts = useCallback(async () => {
    try {
      setSavedAccounts(await readSavedAccounts());
    } catch {
      setSavedAccounts([]);
    }
  }, []);

  const persistAccount = useCallback((next: Account) => {
    setAccount(next);
    void updateStoredAccount(next)
      .then(async () => setSavedAccounts(await readSavedAccounts()))
      .catch(() => undefined);
  }, []);

  const refreshSession = useCallback(async () => {
    setState('loading');
    try {
      const token = await getStoredToken();
      if (!token) {
        setAccount(null);
        setState('signed-out');
        await refreshSavedAccounts();
        return;
      }
      const current = await loadAccountWithRetry(() => getMyAccount());
      persistAccount(current);
      setState('signed-in');
    } catch (error) {
      const status = getSessionValidationStatus(error);
      if (status === 401 || status === 403) {
        await clearStoredToken();
        setAccount(null);
        await refreshSavedAccounts();
        setState('signed-out');
      } else {
        setState('error');
      }
    }
  }, [persistAccount, refreshSavedAccounts]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string, deviceId: string) => {
    const result = await requestMobileDeviceLogin({ email: email.trim(), password, deviceId });
    if (result.requiresCode) {
      if (!result.challengeId) throw new Error('No pudimos iniciar la verificación del dispositivo.');
      return { challengeId: result.challengeId };
    }
    if (!result.token || !result.usuario) throw new Error('El servidor no confirmó el inicio de sesión.');
    await storeToken(result.token, result.usuario);
    queryClient.clear();
    setAccount(result.usuario);
    await refreshSavedAccounts();
    setState('signed-in');
    return {};
  }, [queryClient, refreshSavedAccounts]);

  const confirmDeviceLogin = useCallback(async (email: string, deviceId: string, challengeId: number, code: string) => {
    const session = await confirmMobileDeviceLogin({ email: email.trim().toLowerCase(), deviceId, challengeId, code });
    await storeToken(session.token, session.usuario);
    queryClient.clear();
    setAccount(session.usuario);
    await refreshSavedAccounts();
    setState('signed-in');
  }, [queryClient, refreshSavedAccounts]);

  const signUp = useCallback(async (input: AuthRegisterInput) => {
    await registerAccount(input);
  }, []);

  const requestRegistrationCode = useCallback(async (email: string) => {
    await requestRegistrationEmailVerification({ email: email.trim().toLowerCase() });
  }, []);

  const confirmRegistrationCode = useCallback(async (email: string, code: string) => {
    const session = await confirmRegistrationEmailVerification({ email: email.trim().toLowerCase(), code });
    await storeToken(session.token, session.usuario);
    queryClient.clear();
    setAccount(session.usuario);
    await refreshSavedAccounts();
    setState('signed-in');
    return session.usuario;
  }, [queryClient, refreshSavedAccounts]);

  const signOut = useCallback(async () => {
    void logoutAccount().catch(() => undefined);
    await clearStoredToken();
    queryClient.clear();
    setAccount(null);
    await refreshSavedAccounts();
    setState('signed-out');
  }, [queryClient, refreshSavedAccounts]);

  const switchSavedAccount = useCallback(async (accountId: number) => {
    const nextToken = await getSavedAccountToken(accountId);
    if (!nextToken) throw new Error('No encontramos la sesión guardada. Volvé a iniciar sesión.');
    const previousToken = await getStoredToken();
    const previousAccount = account;
    await activateStoredToken(nextToken);
    queryClient.clear();
    try {
      const current = await loadAccountWithRetry(() => getMyAccount());
      persistAccount(current);
      await refreshSavedAccounts();
      setState('signed-in');
      return current;
    } catch (error) {
      const status = getSessionValidationStatus(error);
      if (status === 401 || status === 403) {
        await removeStoredAccountByToken(nextToken);
        await refreshSavedAccounts();
        if (previousToken && previousAccount) {
          await activateStoredToken(previousToken);
          setAccount(previousAccount);
          setState('signed-in');
          throw new Error('La sesión guardada venció. Ingresá de nuevo para agregar esta cuenta.');
        }
        await clearStoredToken();
        setAccount(null);
        setState('signed-out');
        throw new Error('La sesión guardada venció. Ingresá de nuevo para agregar esta cuenta.');
      }
      if (previousToken) await activateStoredToken(previousToken);
      queryClient.clear();
      if (previousAccount) {
        setAccount(previousAccount);
        setState('signed-in');
      }
      throw error;
    }
  }, [account, persistAccount, queryClient, refreshSavedAccounts]);

  const switchRole = useCallback(async (role: 'cliente' | 'profesional') => {
    const updatedAccount = await switchRoleAfterServerConfirmation(
      role,
      switchAccountRole,
      setAccount,
    );
    await queryClient.invalidateQueries();
    return updatedAccount;
  }, [queryClient]);

  const value = useMemo(() => ({
    account,
    savedAccounts,
    state,
    signIn,
    confirmDeviceLogin,
    signUp,
    requestRegistrationCode,
    confirmRegistrationCode,
    signOut,
    switchSavedAccount,
    switchRole,
    refreshSession,
    setAccount: persistAccount,
  }), [account, savedAccounts, state, signIn, confirmDeviceLogin, signUp, requestRegistrationCode, confirmRegistrationCode, signOut, switchSavedAccount, switchRole, refreshSession, persistAccount]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return value;
}