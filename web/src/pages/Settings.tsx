import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chainName, shortAddress } from '../../../shared/src/chains';
import { DEV_ACCOUNTS } from '../../../shared/src/devAccounts';
import { del, errorMessage, get, patch, post, put } from '../api';
import { useAuth } from '../auth';
import { ErrorNotice, Field, formatDate, usePageTitle, useToast } from '../components/ui';
import type { Signer } from '../wallet';
import { hasInjectedWallet } from '../walletDetect';

type WalletModule = typeof import('../wallet');

export function SettingsPage() {
  usePageTitle('Profile and wallets');
  const { me, config } = useAuth();
  return (
    <div className="container narrow page">
      <h1>Profile and wallets</h1>
      <Profile key={me?.user?.id} />
      <Wallets />
      {config?.devMode && <DevTools />}
    </div>
  );
}

function Profile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const save = useMutation({
    mutationFn: () => patch('/api/me', { displayName, bio }),
    onSuccess: () => {
      toast('Profile saved.');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
  return (
    <form
      className="card section"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <h2>Profile</h2>
      <Field label="Display name" htmlFor="displayName" hint="Shown to your communities and printed on new credentials.">
        <input id="displayName" value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} />
      </Field>
      <Field label="Bio" htmlFor="bio">
        <textarea id="bio" rows={3} value={bio} maxLength={500} onChange={(e) => setBio(e.target.value)} />
      </Field>
      <button className="btn primary" disabled={save.isPending || !displayName.trim()}>
        Save
      </button>
      {save.error && <ErrorNotice error={save.error} />}
    </form>
  );
}

function Wallets() {
  const { me, config, authenticate } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = useMutation({
    mutationFn: (id: string) => del(`/api/me/wallets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
  async function link(make: (w: WalletModule) => Signer | Promise<Signer>) {
    setBusy(true);
    setError(null);
    try {
      await authenticate(await make(await import('../wallet')), 'link');
      toast('Wallet linked.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card section">
      <h2>Wallets</h2>
      <p className="muted small">
        Token checks add up holdings across all your linked wallets. Linking needs a signature from each wallet, so nobody can claim a
        wallet they don't control.
      </p>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {me?.wallets?.map((w) => (
          <li key={w.id} className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
            <span>
              <span className="mono">{w.address}</span>
              <span className="tiny muted"> · verified {formatDate(w.verifiedAt)}</span>
            </span>
            {(me.wallets?.length ?? 0) > 1 && (
              <button className="btn small danger" onClick={() => confirm('Unlink this wallet?') && remove.mutate(w.id)}>
                Unlink
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="row">
        {hasInjectedWallet() && (
          <button className="btn" disabled={busy} onClick={() => link((w) => w.injectedSigner())}>
            Link browser wallet
          </button>
        )}
        {config?.devMode && (
          <>
            <button className="btn" disabled={busy} onClick={() => link((w) => w.burnerSigner(true))}>
              Link a new test wallet
            </button>
            <select
              aria-label="Link a development wallet"
              defaultValue=""
              disabled={busy}
              onChange={(e) => {
                const account = DEV_ACCOUNTS.find((a) => a.address === e.target.value);
                if (account) link((w) => w.keySigner(account.privateKey, account.label));
                e.target.value = '';
              }}
              style={{ width: 'auto' }}
            >
              <option value="">Link a dev wallet…</option>
              {DEV_ACCOUNTS.map((a) => (
                <option key={a.address} value={a.address}>
                  {a.label}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {error && <div className="notice bad small" style={{ marginTop: 10 }}>{error}</div>}
      {remove.error && <ErrorNotice error={remove.error} />}
    </section>
  );
}

interface DevBalance {
  chainId: number;
  standard: 'erc20' | 'erc721' | 'erc1155';
  contract: string;
  tokenId: string;
  owner: string;
  balance: string;
}

function DevTools() {
  const { me, config } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const balances = useQuery({ queryKey: ['dev-balances'], queryFn: () => get<{ balances: DevBalance[] }>('/api/dev/balances') });
  const chain = useQuery({ queryKey: ['dev-chain'], queryFn: () => get<{ mode: string; down: boolean }>('/api/dev/chain') });
  const wallets = me?.wallets ?? [];
  const [form, setForm] = useState({
    owner: wallets[0]?.address ?? '',
    chainId: config?.supportedChainIds[0] ?? 8453,
    standard: 'erc721' as DevBalance['standard'],
    contract: '0x000000000000000000000000000000000000c0de',
    tokenId: '',
    balance: '1',
  });
  useEffect(() => {
    if (!form.owner && wallets[0]) setForm((f) => ({ ...f, owner: wallets[0]!.address }));
  }, [wallets, form.owner]);
  const save = useMutation({
    mutationFn: () => put('/api/dev/balances', { ...form, tokenId: form.standard === 'erc1155' ? form.tokenId || '0' : undefined }),
    onSuccess: () => {
      toast('Test balance updated.');
      qc.invalidateQueries();
    },
  });
  // Local state so the checkbox reflects the click immediately, before the server confirms.
  const [outage, setOutage] = useState<boolean | null>(null);
  const toggle = useMutation({
    mutationFn: (down: boolean) => post('/api/dev/chain', { down }),
    onError: () => setOutage(null),
    onSettled: () => qc.invalidateQueries(),
  });
  if (chain.data?.mode !== 'mock') return null;
  return (
    <section className="card section" style={{ borderStyle: 'dashed' }}>
      <div className="row between">
        <h2 style={{ margin: 0 }}>Developer tools</h2>
        <span className="badge warn">Mock chain</span>
      </div>
      <p className="muted small">Simulate token holdings and provider outages. Only available while the server runs in dev mode.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="form-grid">
          <Field label="Wallet" htmlFor="dev-owner">
            <select id="dev-owner" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })}>
              {wallets.map((w) => (
                <option key={w.id} value={w.address}>
                  {shortAddress(w.address)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chain" htmlFor="dev-chain">
            <select id="dev-chain" value={form.chainId} onChange={(e) => setForm({ ...form, chainId: Number(e.target.value) })}>
              {(config?.supportedChainIds ?? []).map((id) => (
                <option key={id} value={id}>
                  {chainName(id)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Standard" htmlFor="dev-standard">
            <select id="dev-standard" value={form.standard} onChange={(e) => setForm({ ...form, standard: e.target.value as DevBalance['standard'] })}>
              <option value="erc721">ERC-721 (NFT)</option>
              <option value="erc1155">ERC-1155</option>
              <option value="erc20">ERC-20 (raw units)</option>
            </select>
          </Field>
        </div>
        <Field label="Contract" htmlFor="dev-contract">
          <input id="dev-contract" className="mono" value={form.contract} onChange={(e) => setForm({ ...form, contract: e.target.value })} />
        </Field>
        <div className="form-grid">
          {form.standard === 'erc1155' && (
            <Field label="Token ID" htmlFor="dev-token">
              <input id="dev-token" value={form.tokenId} onChange={(e) => setForm({ ...form, tokenId: e.target.value })} />
            </Field>
          )}
          <Field label="Balance" htmlFor="dev-balance" hint={form.standard === 'erc20' ? 'Smallest units (wei).' : 'Use 0 to remove.'}>
            <input id="dev-balance" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} />
          </Field>
        </div>
        <button className="btn" disabled={save.isPending}>
          Set balance
        </button>
        {save.error && <ErrorNotice error={save.error} />}
      </form>
      {balances.data && balances.data.balances.length > 0 && (
        <div className="table-wrap" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Token</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {balances.data.balances.map((b) => (
                <tr key={`${b.owner}-${b.contract}-${b.tokenId}-${b.standard}`}>
                  <td className="mono">{shortAddress(b.owner)}</td>
                  <td>
                    {b.standard.toUpperCase()} <span className="mono">{shortAddress(b.contract)}</span>
                    {b.tokenId ? ` #${b.tokenId}` : ''} · {chainName(b.chainId)}
                  </td>
                  <td className="num">{b.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <hr />
      <label className="check">
        <input
          type="checkbox"
          checked={outage ?? chain.data?.down ?? false}
          onChange={(e) => {
            setOutage(e.target.checked);
            toggle.mutate(e.target.checked);
          }}
        />
        <span>
          Simulate a blockchain provider outage
          <span className="hint muted small" style={{ display: 'block' }}>
            Token checks fail, so learners see a retry message instead of losing access.
          </span>
        </span>
      </label>
    </section>
  );
}
