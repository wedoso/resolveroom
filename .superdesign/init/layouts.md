# Shared layouts

## AppShell

Source: `src/web/components.tsx`. Sticky product header shared by authenticated pages.

```tsx
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
```
