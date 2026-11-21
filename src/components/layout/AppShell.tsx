import { AnimatePresence, motion } from 'framer-motion';
import {
  BarChart3,
  CalendarClock,
  Cpu,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Settings as SettingsIcon,
  Sun,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { useTheme } from '@/hooks/useTheme';
import { useSettings } from '@/hooks/useSettings';
import { useNow } from '@/hooks/useNow';
import { cn } from '@/lib/cn';
import { Badge, LiveDot } from '@/components/ui/Badge';
import { Wordmark } from './Logo';
import { DemoBanner } from './DemoBanner';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const ADMIN_NAV: NavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/shifts', label: 'Shifts', icon: CalendarClock },
  { to: '/admin/employees', label: 'Employees', icon: Users },
  { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/admin/reports', label: 'Reports', icon: FileText },
  { to: '/admin/devices', label: 'Devices', icon: Cpu },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

const EMPLOYEE_NAV: NavItem[] = [
  { to: '/employee', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/employee/shifts', label: 'My shifts', icon: History },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, signOut } = useAuth();
  const navigate = useNavigate();
  const { data: settings } = useSettings();
  const items = profile?.role === 'admin' ? ADMIN_NAV : EMPLOYEE_NAV;

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-6">
        <Wordmark sub={settings?.business_name ?? 'Visitor management'} />
      </div>
      <div className="label px-6 pb-2">{profile?.role === 'admin' ? 'Administration' : 'Workspace'}</div>
      <nav className="flex-1 space-y-0.5 px-3">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate}
            className={({ isActive }) => cn(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
              isActive ? 'text-fg' : 'text-subtle hover:bg-elevated/70 hover:text-fg',
            )}>
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border bg-elevated"
                    transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
                )}
                <Icon className={cn('relative h-[18px] w-[18px]', isActive && 'text-brand')} />
                <span className="relative">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="m-3 rounded-2xl border bg-elevated/50 p-3">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand/80 to-female/70 text-sm font-semibold text-white">
            {profile?.full_name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{profile?.full_name}</div>
            <div className="truncate text-xs capitalize text-subtle">@{profile?.username} · {profile?.role}</div>
          </div>
          <button title="Sign out" aria-label="Sign out"
            onClick={async () => { await signOut(); navigate('/login', { replace: true }); }}
            className="rounded-lg p-2 text-subtle transition-colors hover:bg-surface hover:text-danger">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function Topbar({ onMenu }: { onMenu: () => void }) {
  const { resolved, toggle } = useTheme();
  const { data: settings } = useSettings();
  const now = useNow(1000);
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-bg/80 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <button onClick={onMenu} className="-ml-1 rounded-lg p-2 text-muted hover:bg-elevated lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>
      <div className="flex min-w-0 items-center gap-2.5">
        {online ? <LiveDot /> : <LiveDot tone="danger" />}
        <span className="truncate text-sm text-muted">{online ? 'Live' : 'Offline — reconnecting'}</span>
        {settings && (
          <Badge tone={settings.system_mode === 'production' ? 'ok' : 'warn'} className="ml-1 hidden sm:inline-flex">
            {settings.system_mode === 'production' ? 'Production' : 'Demo mode'}
          </Badge>
        )}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium tabular notranslate">{new Date(now).toLocaleTimeString('en-GB')}</div>
          <div className="text-[11px] text-subtle">{new Date(now).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <button onClick={toggle} aria-label="Toggle theme"
          className="ml-2 grid h-9 w-9 place-items-center rounded-xl border bg-surface text-muted transition-colors hover:text-fg">
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={resolved} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.18 }}>
              {resolved === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </header>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="min-h-screen bg-bg">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 border-r bg-surface/40 lg:block">
        <Sidebar />
      </aside>
      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" onClick={() => setOpen(false)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
            <motion.aside className="fixed inset-y-0 left-0 z-50 w-72 border-r bg-surface lg:hidden"
              initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} transition={{ type: 'spring', stiffness: 400, damping: 40 }}>
              <button onClick={() => setOpen(false)} className="absolute right-3 top-6 rounded-lg p-2 text-subtle hover:bg-elevated" aria-label="Close menu">
                <X className="h-4 w-4" />
              </button>
              <Sidebar onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
      <div className="lg:pl-64">
        <Topbar onMenu={() => setOpen(true)} />
        <DemoBanner />
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <motion.div key={location.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {children ?? <Outlet />}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
