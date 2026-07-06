import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { get, post, setTokens, hasSession, setSessionExpiredHandler } from './api/client';
import type { User } from './api/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login(email: string, password: string): Promise<void>;
  register(orgName: string, name: string, email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState>(null as never);
export const useAuth = () => useContext(AuthContext);

interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
    if (!hasSession()) {
      setLoading(false);
      return;
    }
    get<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await post<AuthResponse>('/auth/login', { email, password });
    setTokens(r.accessToken, r.refreshToken);
    setUser(r.user);
  }, []);

  const register = useCallback(
    async (orgName: string, name: string, email: string, password: string) => {
      const r = await post<AuthResponse>('/auth/register', { orgName, name, email, password });
      setTokens(r.accessToken, r.refreshToken);
      setUser(r.user);
    },
    []
  );

  const logout = useCallback(async () => {
    const refreshToken = localStorage.getItem('refreshToken');
    await post('/auth/logout', { refreshToken }).catch(() => {});
    setTokens(null, null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
