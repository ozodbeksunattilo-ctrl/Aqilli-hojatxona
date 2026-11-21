import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

export type ThemePref = 'dark' | 'light' | 'system';
interface ThemeCtx {
  pref: ThemePref;
  resolved: 'dark' | 'light';
  setPref: (p: ThemePref) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const media = () => window.matchMedia('(prefers-color-scheme: dark)');

function read(): ThemePref {
  try {
    const v = localStorage.getItem('sr-theme');
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(read);
  const [systemDark, setSystemDark] = useState(() => media().matches);

  useEffect(() => {
    const m = media();
    const on = () => setSystemDark(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  const resolved = pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;

  // Layout effect: the class must be applied before children read the CSS tokens.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#09090b' : '#f8f8fa');
  }, [resolved]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem('sr-theme', p);
    } catch {
      /* private mode */
    }
  }, []);

  const toggle = useCallback(() => setPref(resolved === 'dark' ? 'light' : 'dark'), [resolved, setPref]);

  return <Ctx.Provider value={{ pref, resolved, setPref, toggle }}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme outside ThemeProvider');
  return ctx;
}
