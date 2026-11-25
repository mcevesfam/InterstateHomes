'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@interstate/shared';

export type AuthMode = 'demo' | 'postgres';

export interface AuthUser {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  subCompanyId: string | null;
  mfaEnabled?: boolean;
}

interface AuthMeResponse {
  mode?: AuthMode;
  authenticated?: boolean;
  mfaPending?: boolean;
  sessionTimeoutMinutes?: number;
  message?: string;
  user?: {
    userId?: string;
    id?: string;
    email?: string;
    fullName?: string;
    role?: UserRole;
    subCompanyId?: string | null;
    mfaEnabled?: boolean;
  } | null;
}

interface RoleContextValue {
  role: UserRole;
  setRole: (role: UserRole) => void;
  subCompanyId: string;
  authMode: AuthMode;
  user: AuthUser | null;
  authenticated: boolean;
  loading: boolean;
  authError: string | null;
  sessionTimeoutMinutes: number;
  refreshSession: () => Promise<AuthUser | null>;
  retryAuth: () => Promise<void>;
  logout: () => Promise<void>;
}

const DEFAULT_SUB_ID = 'sub-red-cliffs';

const RoleContext = createContext<RoleContextValue>({
  role: 'estimator_approver',
  setRole: () => {},
  subCompanyId: DEFAULT_SUB_ID,
  authMode: 'postgres',
  user: null,
  authenticated: false,
  loading: true,
  authError: null,
  sessionTimeoutMinutes: 30,
  refreshSession: async () => null,
  retryAuth: async () => {},
  logout: async () => {},
});

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [role, setRoleState] = useState<UserRole>('estimator_approver');
  const [subCompanyId, setSubCompanyId] = useState<string>(DEFAULT_SUB_ID);
  const [authMode, setAuthMode] = useState<AuthMode>('postgres');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authenticated, setAuthenticated] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sessionTimeoutMinutes, setSessionTimeoutMinutes] = useState<number>(30);

  const refreshSession = useCallback(async (): Promise<AuthUser | null> => {
    setAuthError(null);
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          'x-demo-role': role,
          'x-demo-sub-id': subCompanyId,
        },
      });

      if (res.status === 401) {
        setAuthMode('postgres');
        setUser(null);
        setAuthenticated(false);
        setAuthError(null);
        return null;
      }

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { message?: string };
        setUser(null);
        setAuthenticated(false);
        setAuthError(
          errData.message ??
            `Authentication service returned HTTP ${res.status}. Please retry in a moment.`
        );
        return null;
      }

      const data = (await res.json()) as AuthMeResponse;
      const detectedMode: AuthMode = data.mode === 'demo' ? 'demo' : 'postgres';
      setAuthMode(detectedMode);

      if (typeof data.sessionTimeoutMinutes === 'number') {
        setSessionTimeoutMinutes(data.sessionTimeoutMinutes);
      }

      const rawUser = data.user;
      const resolvedUserId = rawUser?.userId ?? rawUser?.id;
      const validUser: AuthUser | null =
        rawUser && resolvedUserId && resolvedUserId !== 'anonymous' && rawUser.role
          ? {
              userId: resolvedUserId,
              email: rawUser.email ?? '',
              fullName: rawUser.fullName ?? rawUser.email ?? 'Signed-in User',
              role: rawUser.role,
              subCompanyId: rawUser.subCompanyId ?? null,
              mfaEnabled: rawUser.mfaEnabled,
            }
          : null;

      if (detectedMode === 'postgres') {
        const isAuthed = Boolean(validUser) && data.authenticated !== false && data.mfaPending !== true;
        setUser(isAuthed ? validUser : null);
        setAuthenticated(isAuthed);
        if (isAuthed && validUser) {
          setRoleState(validUser.role);
          setSubCompanyId(validUser.subCompanyId ?? DEFAULT_SUB_ID);
        }
        return isAuthed ? validUser : null;
      }

      setUser(validUser);
      setAuthenticated(true);
      return validUser;
    } catch {
      setUser(null);
      setAuthenticated(false);
      setAuthError(
        'Unable to reach the Interstate Homes authentication service. Check your connection and try again.'
      );
      return null;
    } finally {
      setLoading(false);
    }
  }, [role, subCompanyId]);

  const retryAuth = useCallback(async () => {
    setLoading(true);
    setAuthError(null);
    await refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    void refreshSession();
    // Only run initial mount check; subsequent updates call refreshSession explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handleSessionExpired = () => {
      setAuthMode('postgres');
      setUser(null);
      setAuthenticated(false);
      setAuthError(null);
      setLoading(false);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        router.replace('/login');
      }
    };

    window.addEventListener('interstate:session-expired', handleSessionExpired);
    return () => window.removeEventListener('interstate:session-expired', handleSessionExpired);
  }, [router]);

  const setRole = useCallback(
    (nextRole: UserRole) => {
      if (authMode === 'demo') {
        setRoleState(nextRole);
      }
    },
    [authMode]
  );

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
      });
    } finally {
      setUser(null);
      setAuthenticated(false);
      setAuthError(null);
    }
  }, []);

  return (
    <RoleContext.Provider
      value={{
        role,
        setRole,
        subCompanyId,
        authMode,
        user,
        authenticated,
        loading,
        authError,
        sessionTimeoutMinutes,
        refreshSession,
        retryAuth,
        logout,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
