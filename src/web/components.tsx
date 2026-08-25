import {
  AlertTriangle,
  Bell,
  Check,
  ChevronDown,
  LoaderCircle,
  LockKeyhole,
  Menu,
  X,
} from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from './api';

type User = { id: string; displayName: string; email: string; avatarUrl: string | null };
type AuthValue = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = async () => {
    try {
      const value = await api<{ user: User }>('/auth/me');
      setUser(value.user);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setUser(null);
      else throw error;
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const signIn = async (email: string, name: string) => {
    const value = await api<{ user: User }>('/auth/development', {
      method: 'POST',
      body: JSON.stringify({ email, display_name: name }),
    });
    setUser(value.user);
  };
  const signOut = async () => {
    await api('/auth/logout', { method: 'POST' });
    setUser(null);
  };
  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}
export const useAuth = () => {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
};

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="brand" aria-label="ResolveRoom home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <b />
      </span>
      {!compact && <span>ResolveRoom</span>}
    </Link>
  );
}
export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);
  return (
    <div className="app-canvas">
      <header className="topbar">
        <Brand />
        <button
          className="icon-button mobile-menu"
          aria-label="Open navigation"
          onClick={() => setMenu(!menu)}
        >
          <Menu />
        </button>
        <nav className={menu ? 'main-nav open' : 'main-nav'} aria-label="Primary">
          <NavLink to="/dashboard">Conflicts</NavLink>
          <NavLink to="/agents">Agents</NavLink>
          <NavLink to="/notifications">Notifications</NavLink>
        </nav>
        <div className="account">
          <Link
            to="/notifications"
            className="icon-button notification-button"
            aria-label="Notifications"
          >
            <Bell />
            <i />
          </Link>
          {user ? (
            <button className="account-button" onClick={() => void signOut()} title="Sign out">
              <span>{user.displayName.slice(0, 1).toUpperCase()}</span>
              <span className="account-name">{user.displayName}</span>
              <ChevronDown />
            </button>
          ) : (
            <Link className="button small" to="/signin">
              Sign in
            </Link>
          )}
        </div>
      </header>
      {children}
    </div>
  );
}

export function PageLoading({ label = 'Loading your room…' }: { label?: string }) {
  return (
    <main className="state-page" aria-live="polite">
      <LoaderCircle className="spin" />
      <h1>{label}</h1>
      <p>Retrieving the canonical record.</p>
    </main>
  );
}
export function StatePanel({
  icon = 'info',
  title,
  children,
  action,
}: {
  icon?: 'info' | 'error' | 'success';
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`state-panel ${icon}`} role={icon === 'error' ? 'alert' : undefined}>
      {icon === 'error' ? (
        <AlertTriangle />
      ) : icon === 'success' ? (
        <Check />
      ) : (
        <span className="state-glyph">·</span>
      )}
      <h2>{title}</h2>
      <div>{children}</div>
      {action && <div className="state-actions">{action}</div>}
    </section>
  );
}
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`status-badge status-${status}`}>
      <i />
      {status.replaceAll('_', ' ')}
    </span>
  );
}

export function Dialog({
  open,
  title,
  description,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) dialog?.showModal();
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-card">
        <button className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}>
          <X />
        </button>
        <h2>{title}</h2>
        {description && <p className="muted">{description}</p>}
        <div className="dialog-body">{children}</div>
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  danger = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} title={title} description={description} onClose={onClose}>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button secondary" onClick={onClose}>
          Keep conflict
        </button>
        <button
          className={`button ${danger ? 'danger' : ''}`}
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? <LoaderCircle className="spin" /> : confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}

export function PrivacyNote() {
  return (
    <div className="privacy-note">
      <LockKeyhole />
      <div>
        <strong>Only you and your authorized agent</strong>
        <p>
          This context is never shared with the other party or included in the Judge’s case record.
        </p>
      </div>
    </div>
  );
}

export function SignInForm() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      await signIn(String(data.get('email')), String(data.get('name')));
      navigate((location.state as any)?.from ?? '/dashboard', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign in failed.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label>
        Display name
        <input name="name" required minLength={2} autoComplete="name" placeholder="Alice Chen" />
      </label>
      <label>
        Email address
        <input
          name="email"
          required
          type="email"
          autoComplete="email"
          placeholder="alice@example.com"
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button wide" disabled={busy}>
        {busy ? (
          <>
            <LoaderCircle className="spin" />
            Signing in…
          </>
        ) : (
          'Continue securely'
        )}
      </button>
      <p className="form-footnote">
        Local development sign-in creates a real persisted ResolveRoom account. Production uses
        configured Google or GitHub OAuth.
      </p>
    </form>
  );
}
