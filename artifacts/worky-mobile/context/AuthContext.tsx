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
  loginAccount,
  logoutAccount,
  registerAccount,
  switchAccountRole,
  type Account,
  type AuthRegisterInput,
} from '@workspace/api-client-react';
import { clearStoredToken, getStoredToken, storeToken } from '@/lib/session';

type SessionState = 'loading' | 'signed-in' | 'signed-out' | 'error';

interface AuthContextValue {
  account: Account | null;
  state: SessionState;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: AuthRegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  switchRole: (role: 'cliente' | 'profesional') => Promise<Account>;
  refreshSession: () => Promise<void>;
  setAccount: (account: Account) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function getStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof value.status === 'number') return value.status;
  if (typeof value.response?.status === 'number') return value.response.status;
  return undefined;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [account, setAccount] = useState<Account | null>(null);
  const [state, setState] = useState<SessionState>('loading');

  const refreshSession = useCallback(async () => {
    setState('loading');
    try {
      const token = await getStoredToken();
      if (!token) {
        setAccount(null);
        setState('signed-out');
        return;
      }
      const current = await getMyAccount();
      setAccount(current);
      setState('signed-in');
    } catch (error) {
      if (getStatusCode(error) === 401) {
        await clearStoredToken();
        setAccount(null);
        setState('signed-out');
      } else {
        setState('error');
      }
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const session = await loginAccount({ email: email.trim(), password });
    await storeToken(session.token);
    queryClient.clear();
    setAccount(session.usuario);
    setState('signed-in');
  }, [queryClient]);

  const signUp = useCallback(async (input: AuthRegisterInput) => {
    const session = await registerAccount(input);
    await storeToken(session.token);
    queryClient.clear();
    setAccount(session.usuario);
    setState('signed-in');
  }, [queryClient]);

  const signOut = useCallback(async () => {
    try {
      await logoutAccount();
    } catch {
      // The local session still needs to end if the network is unavailable.
    }
    await clearStoredToken();
    queryClient.clear();
    setAccount(null);
    setState('signed-out');
  }, [queryClient]);

  const switchRole = useCallback(async (role: 'cliente' | 'profesional') => {
    const updatedAccount = await switchAccountRole({ rol: role });
    setAccount(updatedAccount);
    await queryClient.invalidateQueries();
    return updatedAccount;
  }, [queryClient]);

  const value = useMemo(() => ({
    account,
    state,
    signIn,
    signUp,
    signOut,
    switchRole,
    refreshSession,
    setAccount,
  }), [account, state, signIn, signUp, signOut, switchRole, refreshSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return value;
}