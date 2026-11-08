import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Config, Me } from '../../shared/types';
import { api } from './api';

interface AuthState {
  me: Me | null;
  config: Config | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const data = await api.get<{ me: Me | null }>('/api/auth/me');
    setMe(data.me);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [meResponse, configResponse] = await Promise.all([
          api.get<{ me: Me | null }>('/api/auth/me'),
          api.get<Config>('/api/config'),
        ]);
        if (!alive) return;
        setMe(meResponse.me);
        setConfig(configResponse);
      } catch (error) {
        console.error('Could not load session', error);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      setMe(null);
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({ me, config, loading, refresh, setMe, logout }),
    [me, config, loading, refresh, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
