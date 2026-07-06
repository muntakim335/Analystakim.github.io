import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../api/client';
import { useAuth } from '../auth';
import type { Notification } from '../api/types';
import { timeAgo } from '../api/types';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/leads', label: 'Leads', icon: '◎' },
  { to: '/contacts', label: 'Contacts', icon: '☺' },
  { to: '/companies', label: 'Companies', icon: '▤' },
  { to: '/deals', label: 'Deals', icon: '⬢' },
  { to: '/tasks', label: 'Tasks', icon: '☑' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    localStorage.setItem('theme', next ? 'dark' : 'light');
  };
  return { dark, toggle };
}

interface SearchHit {
  id: string;
  label: string;
  sub: string | null;
}
interface SearchResults {
  contacts: SearchHit[];
  companies: SearchHit[];
  leads: SearchHit[];
  deals: SearchHit[];
}

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const navigate = useNavigate();
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const handle = setTimeout(() => {
      get<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          setResults(r);
          setOpen(true);
        })
        .catch(() => {});
    }, 250);
    return () => clearTimeout(handle);
  }, [q]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', onDown);
    return () => removeEventListener('mousedown', onDown);
  }, []);

  const go = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  const groups = results
    ? ([
        ['Contacts', results.contacts, () => '/contacts'],
        ['Companies', results.companies, () => '/companies'],
        ['Leads', results.leads, () => '/leads'],
        ['Deals', results.deals, () => '/deals'],
      ] as const)
    : [];

  return (
    <div className="relative w-full max-w-md" ref={boxRef}>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results && setOpen(true)}
        placeholder="Search contacts, companies, leads, deals…"
        aria-label="Global search"
        className="w-full rounded-lg border border-[var(--grid)] bg-[var(--page)] px-3 py-1.5 text-sm placeholder-[var(--ink-muted)] focus:border-[var(--series-1)] focus:outline-none"
      />
      {open && results && (
        <div className="absolute top-full z-40 mt-1 w-full overflow-hidden rounded-lg border border-[var(--grid)] bg-[var(--surface-1)] shadow-lg">
          {groups.every(([, hits]) => hits.length === 0) && (
            <p className="px-3 py-2 text-sm text-[var(--ink-muted)]">No results for “{q}”</p>
          )}
          {groups.map(([label, hits, path]) =>
            hits.length === 0 ? null : (
              <div key={label}>
                <p className="bg-[var(--page)] px-3 py-1 text-xs font-medium uppercase text-[var(--ink-muted)]">
                  {label}
                </p>
                {hits.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => go(path())}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-black/5 dark:hover:bg-white/5"
                  >
                    {h.label}
                    {h.sub && <span className="ml-2 text-xs text-[var(--ink-muted)]">{h.sub}</span>}
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}

function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => get<{ data: Notification[]; unreadCount: number }>('/notifications'),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('mousedown', onDown);
    return () => removeEventListener('mousedown', onDown);
  }, []);

  const markAllRead = async () => {
    await post('/notifications/read', {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${data?.unreadCount ? ` (${data.unreadCount} unread)` : ''}`}
        className="relative rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
      >
        🔔
        {(data?.unreadCount ?? 0) > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-critical)] px-1 text-[10px] font-bold text-white">
            {data!.unreadCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 overflow-hidden rounded-lg border border-[var(--grid)] bg-[var(--surface-1)] shadow-lg">
          <div className="flex items-center justify-between border-b border-[var(--grid)] px-3 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button onClick={markAllRead} className="text-xs text-[var(--series-1)] hover:underline">
              Mark all read
            </button>
          </div>
          <div className="max-h-96 overflow-y-auto">
            {(data?.data ?? []).length === 0 && (
              <p className="px-3 py-4 text-sm text-[var(--ink-muted)]">You're all caught up.</p>
            )}
            {(data?.data ?? []).map((n) => (
              <div
                key={n.id}
                className={`border-b border-[var(--grid)] px-3 py-2 last:border-0 ${n.readAt ? 'opacity-60' : ''}`}
              >
                <p className="text-sm">{n.title}</p>
                <p className="text-xs text-[var(--ink-muted)]">{timeAgo(n.createdAt)}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside
        className={`${menuOpen ? 'flex' : 'hidden'} fixed inset-y-0 left-0 z-30 w-56 flex-col border-r border-[var(--grid)] bg-[var(--surface-1)] md:static md:flex`}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--series-1)] text-sm font-bold text-white">
            N
          </span>
          <span className="text-base font-semibold">NimbusCRM</span>
        </div>
        <nav className="flex-1 space-y-0.5 px-2" aria-label="Main navigation">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[var(--series-1)]/10 text-[var(--series-1)]'
                    : 'text-[var(--ink-2)] hover:bg-black/5 dark:hover:bg-white/5'
                }`
              }
            >
              <span aria-hidden className="w-4 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-[var(--grid)] p-3 text-sm">
          <p className="truncate font-medium">{user?.name}</p>
          <p className="truncate text-xs text-[var(--ink-muted)]">{user?.email}</p>
          <button onClick={logout} className="mt-2 text-xs text-[var(--series-1)] hover:underline">
            Sign out
          </button>
        </div>
      </aside>
      {menuOpen && (
        <div className="fixed inset-0 z-20 bg-black/30 md:hidden" onClick={() => setMenuOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-[var(--grid)] bg-[var(--surface-1)] px-4 py-2.5">
          <button
            className="rounded-lg p-2 hover:bg-black/5 md:hidden dark:hover:bg-white/10"
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <GlobalSearch />
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={toggle}
              aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="rounded-lg p-2 hover:bg-black/5 dark:hover:bg-white/10"
            >
              {dark ? '☀' : '☾'}
            </button>
            <NotificationBell />
          </div>
        </header>
        <main className="min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
