import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: Kind;
  title: string;
  body?: string;
}
type Push = (kind: Kind, title: string, body?: string) => void;
const Ctx = createContext<Push | null>(null);

const icons = {
  success: <CheckCircle2 className="h-4 w-4 text-ok" />,
  error: <AlertTriangle className="h-4 w-4 text-danger" />,
  info: <Info className="h-4 w-4 text-brand" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const push = useCallback<Push>((kind, title, body) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { id, kind, title, body }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 24 }}
              className="card pointer-events-auto flex items-start gap-3 bg-surface/95 px-4 py-3 backdrop-blur">
              <div className="mt-0.5">{icons[t.kind]}</div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t.title}</p>
                {t.body && <p className="mt-0.5 break-words text-[13px] text-subtle">{t.body}</p>}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  const push = useContext(Ctx);
  if (!push) throw new Error('useToast outside ToastProvider');
  return useMemo(
    () => ({
      success: (title: string, body?: string) => push('success', title, body),
      error: (title: string, body?: string) => push('error', title, body),
      info: (title: string, body?: string) => push('info', title, body),
    }),
    [push],
  );
}
