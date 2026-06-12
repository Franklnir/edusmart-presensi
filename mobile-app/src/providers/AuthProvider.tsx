import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthSession, TenantContext } from '@/types/mobile';
import { clearSession, loadSession, loadTenant, saveSession, saveTenant } from '@/storage/sessionStorage';
import { isAuthApiError, setApiSession, setApiTenant } from '@/api/client';
import { fetchMe, logoutMobile } from '@/api/mobileApi';

type AuthContextValue = {
  booting: boolean;
  session: AuthSession | null;
  tenant: TenantContext | null;
  setTenant: (tenant: TenantContext) => Promise<void>;
  signIn: (session: AuthSession) => Promise<void>;
  signOut: (keepTenant?: boolean) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [session, setSessionState] = useState<AuthSession | null>(null);
  const [tenant, setTenantState] = useState<TenantContext | null>(null);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const [storedSession, storedTenant] = await Promise.all([loadSession(), loadTenant()]);
      if (!mounted) return;

      if (storedSession) {
        // Temporarily set session so API calls can authenticate
        setApiSession(storedSession);
        setApiTenant(storedSession.tenant);

        try {
          // Revalidate token with server
          const serverData = await fetchMe();
          const revalidatedSession: AuthSession = {
            token: storedSession.token,
            tenant: serverData.tenant ?? storedSession.tenant,
            profile: serverData.profile ?? storedSession.profile,
          };

          if (!mounted) return;

          // Save updated profile/tenant from server
          await saveSession(revalidatedSession);
          setSessionState(revalidatedSession);
          setTenantState(revalidatedSession.tenant);
          setApiSession(revalidatedSession);
          setApiTenant(revalidatedSession.tenant);
        } catch (err) {
          if (!mounted) return;
          const fallbackTenant = storedTenant ?? storedSession.tenant;
          if (isAuthApiError(err)) {
            await clearSession(true);
            setSessionState(null);
            setTenantState(fallbackTenant);
            setApiSession(null);
            setApiTenant(fallbackTenant);
            return;
          }

          setSessionState(storedSession);
          setTenantState(storedSession.tenant);
          setApiSession(storedSession);
          setApiTenant(storedSession.tenant);
        }
      } else {
        setSessionState(null);
        setTenantState(storedTenant);
        setApiSession(null);
        setApiTenant(storedTenant);
      }
    }

    boot().finally(() => mounted && setBooting(false));
    return () => {
      mounted = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    booting,
    session,
    tenant,
    setTenant: async nextTenant => {
      await saveTenant(nextTenant);
      setTenantState(nextTenant);
      setApiTenant(nextTenant);
    },
    signIn: async nextSession => {
      await saveSession(nextSession);
      setSessionState(nextSession);
      setTenantState(nextSession.tenant);
      setApiSession(nextSession);
    },
    signOut: async (keepTenant = true) => {
      await logoutMobile();
      await clearSession(keepTenant);
      const storedTenant = keepTenant ? await loadTenant() : null;
      setSessionState(null);
      setTenantState(storedTenant);
      setApiSession(null);
      setApiTenant(storedTenant);
    },
  }), [booting, session, tenant]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
