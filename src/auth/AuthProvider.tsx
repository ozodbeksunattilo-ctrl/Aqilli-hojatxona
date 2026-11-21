import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { backend } from '@/services';
import type { Profile, Role } from '@/types/domain';
import { FullScreenLoader } from '@/components/layout/FullScreenLoader';

interface AuthCtx {
  profile: Profile | null;
  ready: boolean;
  signIn: (username: string, password: string) => Promise<Profile>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setProfile(await backend.currentProfile());
    } catch {
      setProfile(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return backend.onAuthChange(() => void refresh());
  }, [refresh]);

  const signIn = useCallback(async (username: string, password: string) => {
    const p = await backend.signIn(username, password);
    setProfile(p);
    return p;
  }, []);

  const signOut = useCallback(async () => {
    await backend.signOut();
    setProfile(null);
  }, []);

  return <Ctx.Provider value={{ profile, ready, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

export const homeFor = (role: Role) => (role === 'admin' ? '/admin' : '/employee');

/** Route guard. UI convenience only — the database enforces every permission. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { profile, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <FullScreenLoader />;
  if (!profile) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profile.role !== role) return <Navigate to={homeFor(profile.role)} replace />;
  return <>{children}</>;
}
