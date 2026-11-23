import { motion } from 'framer-motion';
import { ArrowRight, Eye, EyeOff, Lock, ShieldCheck, User, Zap } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { homeFor, useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { ErrorNote } from '@/components/ui/misc';
import { Logo, Wordmark } from '@/components/layout/Logo';
import { FullScreenLoader } from '@/components/layout/FullScreenLoader';
import { env } from '@/config/env';
import { errorMessage } from '@/services';
import { formatNumber } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';
import { LanguageSwitcher } from '@/i18n/LanguageSwitcher';

const DEMO_ACCOUNTS = [
  { username: 'admin', password: 'admin123', role: 'Administrator', name: '' },
  { username: 'asqar', password: 'asqar123', role: 'Employee', name: 'Asqar' },
  { username: 'bekzod', password: 'bekzod123', role: 'Employee', name: 'Bekzod' },
  { username: 'dilnoza', password: 'dilnoza123', role: 'Employee', name: 'Dilnoza' },
];

/** Decorative live counter on the brand panel. */
function Showcase() {
  const t = useT();
  const [m, setM] = useState(412);
  const [f, setF] = useState(287);
  useEffect(() => {
    const t = setInterval(() => (Math.random() > 0.42 ? setM((x) => x + 1) : setF((x) => x + 1)), 1600);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute -inset-8 rounded-[40px] bg-brand/20 blur-3xl" />
      <div className="card relative border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
        <div className="mb-5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-white/50">{t('Live · current shift')}</span>
          <span className="flex items-center gap-1.5 text-xs text-emerald-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" /> {t('2 turnstiles online')}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: t('Men'), value: m, color: 'from-sky-400/25 text-sky-300' },
            { label: t('Women'), value: f, color: 'from-pink-400/25 text-pink-300' },
          ].map((c) => (
            <div key={c.label} className={`rounded-2xl border border-white/10 bg-gradient-to-b ${c.color} to-transparent p-4`}>
              <div className="text-xs text-white/50">{c.label}</div>
              <motion.div key={c.value} initial={{ y: -6, opacity: 0.4 }} animate={{ y: 0, opacity: 1 }} className="mt-1 text-3xl font-semibold tabular notranslate">
                {formatNumber(c.value)}
              </motion.div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-end gap-1">
          {[30, 45, 38, 60, 72, 55, 80, 68, 90, 74, 62, 84, 70, 95].map((h, i) => (
            <motion.div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-brand/40 to-brand"
              initial={{ height: 0 }} animate={{ height: h * 0.6 }} transition={{ delay: 0.3 + i * 0.04, duration: 0.6, ease: [0.16, 1, 0.3, 1] }} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { profile, ready, signIn } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return <FullScreenLoader />;
  if (profile) return <Navigate to={homeFor(profile.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const p = await signIn(username, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(homeFor(p.role)) ? from : homeFor(p.role), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-screen bg-bg lg:grid-cols-[1.1fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-[#07070a] text-white lg:flex lg:flex-col">
        <div className="bg-grid absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" style={{ ['--line' as string]: '255 255 255' }} />
        <div className="absolute -left-40 top-1/4 h-[500px] w-[500px] rounded-full bg-brand/25 blur-[120px]" />
        <div className="absolute -right-20 bottom-0 h-[380px] w-[380px] rounded-full bg-pink-500/10 blur-[120px]" />
        <div className="relative flex items-center gap-3 p-10">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">{t('Smart Restroom')}</span>
        </div>
        <div className="relative flex flex-1 flex-col justify-center gap-12 px-12 pb-16">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <h1 className="max-w-lg text-[44px] font-semibold leading-[1.05] tracking-[-0.03em]">
              {t('Every visitor counted.')}<br />
              <span className="bg-gradient-to-r from-white via-white/80 to-brand bg-clip-text text-transparent">{t('Automatically.')}</span>
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/55">
              {t('Turnstile-verified visitor counting, shift accountability and real-time analytics for paid restroom operations.')}
            </p>
          </motion.div>
          <Showcase />
          <div className="flex gap-8 text-sm text-white/50">
            <span className="flex items-center gap-2"><Zap className="h-4 w-4 text-brand" /> {t('Real-time')}</span>
            <span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand" /> {t('Tamper-proof ledger')}</span>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-10 sm:py-12">
        <motion.div className="w-full max-w-[380px]" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }}>
          <div className="mb-8 flex items-start justify-between gap-3 lg:mb-10">
            <div className="lg:hidden"><Wordmark sub={t('Visitor management')} /></div>
            <LanguageSwitcher className="ml-auto shrink-0" />
          </div>
          <h2 className="text-[26px] font-semibold tracking-tight">{t('Sign in')}</h2>
          <p className="mt-1.5 text-sm text-subtle">{t('Use the username and password provided by your administrator.')}</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label htmlFor="username" className="mb-1.5 block text-[13px] font-medium text-muted">{t('Username')}</label>
              <Input id="username" autoComplete="username" autoFocus required value={username} onChange={(e) => setUsername(e.target.value)}
                leading={<User className="h-4 w-4" />} placeholder={t('e.g. asqar')} className="h-11" />
            </div>
            <div>
              <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-muted">{t('Password')}</label>
              <div className="relative">
                <Input id="password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} leading={<Lock className="h-4 w-4" />} placeholder="••••••••" className="h-11 pr-11" />
                <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? t('Hide password') : t('Show password')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-subtle hover:text-fg">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && <ErrorNote message={error} />}
            <Button type="submit" size="lg" loading={loading} className="w-full">
              {!loading && <span key="label" className="inline-flex items-center gap-2">{t('Continue')} <ArrowRight className="h-4 w-4" /></span>}
            </Button>
          </form>

          {env.localDemo && (
            <div className="mt-8 rounded-2xl border border-dashed p-4">
              <div className="label mb-3">{t('Local demo accounts')}</div>
              <div className="grid grid-cols-2 gap-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.username} type="button" onClick={() => { setUsername(a.username); setPassword(a.password); setError(null); }}
                    className="rounded-xl border bg-elevated/50 px-3 py-2 text-left transition-colors hover:border-brand/40 hover:bg-elevated">
                    <div className="text-[13px] font-medium">{a.username}</div>
                    <div className="truncate text-[11px] text-subtle">{t(a.role)}{a.name && ` · ${a.name}`}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="mt-10 text-center text-xs text-subtle">{t('Protected by role-based access control · All actions are audited')}</p>
        </motion.div>
      </div>
    </div>
  );
}
