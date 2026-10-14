import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { DEV_ACCOUNTS } from '../../../shared/src/devAccounts';
import { shortAddress } from '../../../shared/src/chains';
import { errorMessage } from '../api';
import { useAuth } from '../auth';
import type { Signer } from '../wallet';
import { hasInjectedWallet } from '../walletDetect';

type WalletModule = typeof import('../wallet');
import { Avatar, Dialog, useToast } from './ui';

export function Layout() {
  const { user, me, openSignIn, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const managed = (me?.memberships ?? []).filter((m) => m.role !== 'member');

  const links = user
    ? [
        { to: '/dashboard', label: 'Dashboard' },
        { to: '/communities', label: 'Explore' },
        { to: '/rewards', label: 'Rewards' },
        { to: '/credentials', label: 'Credentials' },
        ...(user.isPlatformAdmin ? [{ to: '/admin', label: 'Admin' }] : []),
      ]
    : [{ to: '/communities', label: 'Explore communities' }];

  return (
    <>
      <a href="#main" className="sr-only">
        Skip to content
      </a>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand" aria-label="Ileri home">
            <span className="brand-mark" aria-hidden="true">
              I
            </span>
            Ileri
          </Link>
          <nav className="nav" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="header-account row">
            {user ? (
              <details className="account-menu" style={{ position: 'relative' }} key={location.pathname}>
                <summary className="btn ghost small" style={{ listStyle: 'none' }}>
                  <Avatar name={user.displayName} />
                  <span>{user.displayName}</span>
                </summary>
                <div className="card" style={{ position: 'absolute', right: 0, top: 46, width: 260, padding: 10, zIndex: 30 }}>
                  {managed.length > 0 && (
                    <>
                      <div className="tiny muted" style={{ padding: '4px 8px' }}>
                        Manage
                      </div>
                      {managed.map((m) => (
                        <Link key={m.communityId} className="btn ghost small block" style={{ justifyContent: 'flex-start' }} to={`/manage/${m.slug}`}>
                          {m.name}
                        </Link>
                      ))}
                      <hr style={{ margin: '8px 0' }} />
                    </>
                  )}
                  <Link className="btn ghost small block" style={{ justifyContent: 'flex-start' }} to="/settings">
                    Profile and wallets
                  </Link>
                  <Link className="btn ghost small block" style={{ justifyContent: 'flex-start' }} to="/new-community">
                    Start a community
                  </Link>
                  <button className="btn ghost small block" style={{ justifyContent: 'flex-start' }} onClick={() => signOut()}>
                    Sign out
                  </button>
                </div>
              </details>
            ) : (
              <button className="btn primary small" onClick={openSignIn}>
                Sign in
              </button>
            )}
          </div>
          <button
            className="btn ghost small menu-toggle"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
        </div>
        {menuOpen && (
          <nav id="mobile-nav" className="mobile-nav" aria-label="Mobile" onClick={() => setMenuOpen(false)}>
            {links.map((l) => (
              <Link key={l.to} to={l.to}>
                {l.label}
              </Link>
            ))}
            {user ? (
              <>
                {managed.map((m) => (
                  <Link key={m.communityId} to={`/manage/${m.slug}`}>
                    Manage {m.name}
                  </Link>
                ))}
                <Link to="/settings">Profile and wallets</Link>
                <Link to="/new-community">Start a community</Link>
                <a
                  href="#signout"
                  onClick={(e) => {
                    e.preventDefault();
                    signOut();
                  }}
                >
                  Sign out ({user.displayName})
                </a>
              </>
            ) : (
              <a
                href="#signin"
                onClick={(e) => {
                  e.preventDefault();
                  openSignIn();
                }}
              >
                Sign in
              </a>
            )}
          </nav>
        )}
      </header>
      <main id="main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container row between">
          <span>Ileri. Learning communities can verify.</span>
          <span className="row">
            <Link to="/communities">Communities</Link>
            {user && <Link to="/settings">Settings</Link>}
          </span>
        </div>
      </footer>
      <SignInDialog />
    </>
  );
}

export function SignInDialog() {
  const { signInOpen, closeSignIn, authenticate, config } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(id: string, makeSigner: (w: WalletModule) => Signer | Promise<Signer>) {
    setBusy(id);
    setError(null);
    try {
      const signer = await makeSigner(await import('../wallet'));
      await authenticate(signer);
      closeSignIn();
      toast(`Signed in as ${shortAddress(signer.address)}`);
    } catch (e) {
      const message = errorMessage(e);
      setError(/rejected|denied/i.test(message) ? 'The signature request was cancelled.' : message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={signInOpen} onClose={closeSignIn} title="Sign in">
      <p className="muted small">
        Sign a message with your wallet to prove you own it. It's free and does not send a transaction.
      </p>
      {hasInjectedWallet() ? (
        <button className="wallet-option" disabled={Boolean(busy)} onClick={() => run('injected', (w) => w.injectedSigner())}>
          <strong>Browser wallet</strong>
          <span className="muted small spacer">MetaMask, Rabby, Coinbase Wallet…</span>
          {busy === 'injected' && <span className="small">Waiting…</span>}
        </button>
      ) : (
        <div className="notice small" style={{ marginBottom: 12 }}>
          No browser wallet found. Install a wallet extension, or open this page inside your mobile wallet's browser.
        </div>
      )}
      {config?.devMode && (
        <div style={{ marginTop: 16 }}>
          <div className="row between">
            <h4 style={{ margin: 0 }}>Development wallets</h4>
            <span className="badge warn">Dev mode</span>
          </div>
          <p className="tiny muted">Public test keys. Never send real funds to them.</p>
          {DEV_ACCOUNTS.map((a) => (
            <button
              key={a.address}
              className="wallet-option"
              disabled={Boolean(busy)}
              onClick={() => run(a.address, (w) => w.keySigner(a.privateKey, a.label))}
            >
              <span>{a.label}</span>
              <span className="mono muted spacer" style={{ textAlign: 'right' }}>
                {shortAddress(a.address)}
              </span>
            </button>
          ))}
          <button className="wallet-option" disabled={Boolean(busy)} onClick={() => run('burner', (w) => w.burnerSigner(true))}>
            <span>New test wallet</span>
            <span className="muted small spacer" style={{ textAlign: 'right' }}>
              fresh account
            </span>
          </button>
        </div>
      )}
      {error && (
        <div className="notice bad small" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
