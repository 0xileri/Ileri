import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from './api';
import type { AppConfig, Me, Role } from './types';
import type { Signer } from './wallet';

interface AuthState {
  config: AppConfig | undefined;
  me: Me | undefined;
  loading: boolean;
  user: Me['user'];
  authenticate(signer: Signer, mode?: 'signin' | 'link'): Promise<void>;
  signOut(): Promise<void>;
  signInOpen: boolean;
  openSignIn(): void;
  closeSignIn(): void;
  roleIn(communityId: string): Role | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['config'], queryFn: () => get<AppConfig>('/api/config'), staleTime: Infinity });
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/api/me') });
  const [signInOpen, setSignInOpen] = useState(false);

  const authenticate = useCallback(
    async (signer: Signer, mode: 'signin' | 'link' = 'signin') => {
      const { nonce } = await get<{ nonce: string }>('/api/auth/nonce');
      const statement = config.data?.siweStatement ?? 'Sign in to Ileri.';
      const { buildSiweMessage } = await import('./wallet');
      const message = buildSiweMessage(signer, nonce, statement);
      const signature = await signer.signMessage(message);
      await post('/api/auth/verify', { message, signature, mode });
      await qc.invalidateQueries();
    },
    [config.data, qc],
  );

  const signOut = useCallback(async () => {
    await post('/api/auth/logout');
    qc.removeQueries();
    await qc.invalidateQueries();
  }, [qc]);

  const value = useMemo<AuthState>(
    () => ({
      config: config.data,
      me: me.data,
      loading: me.isLoading,
      user: me.data?.user ?? null,
      authenticate,
      signOut,
      signInOpen,
      openSignIn: () => setSignInOpen(true),
      closeSignIn: () => setSignInOpen(false),
      roleIn: (communityId: string) => me.data?.memberships?.find((m) => m.communityId === communityId)?.role ?? null,
    }),
    [config.data, me.data, me.isLoading, authenticate, signOut, signInOpen],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
