import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken, setUnauthorizedHandler } from './api';

export interface User {
  id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: 'admin' | 'user' | 'viewer';
}

interface MeResponse {
  user: User | null;
  csrfToken: string | null;
  mode: 'production' | 'demo' | 'test';
}

interface AuthState {
  user: User | null;
  mode: MeResponse['mode'];
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setSession: (r: MeResponse) => void;
  canEdit: boolean;
  isAdmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [mode, setMode] = useState<MeResponse['mode']>('production');
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const setSession = useCallback((r: MeResponse) => {
    setCsrfToken(r.csrfToken);
    setUser(r.user);
    setMode(r.mode);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      setUser(null);
    });
    api
      .get<MeResponse>('/api/auth/me')
      .then(setSession)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [setSession]);

  const login = useCallback(
    async (username: string, password: string) => {
      const r = await api.post<MeResponse>('/api/auth/login', { username, password });
      setSession(r);
      qc.clear();
    },
    [qc, setSession],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined);
    setCsrfToken(null);
    setUser(null);
    qc.clear();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      mode,
      loading,
      login,
      logout,
      setSession,
      canEdit: user?.role === 'admin' || user?.role === 'user',
      isAdmin: user?.role === 'admin',
    }),
    [user, mode, loading, login, logout, setSession],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider nedostaje');
  return v;
}
