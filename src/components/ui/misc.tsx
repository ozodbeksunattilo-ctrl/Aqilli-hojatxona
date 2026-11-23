import { animate, motion, useMotionValue, useTransform } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { Skeleton } from './Spinner';

export function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => formatNumber(Math.round(v)));
  useEffect(() => {
    if (value >= mv.get()) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.35, ease: [0.16, 1, 0.3, 1] });
    return controls.stop;
  }, [mv, value]);
  return <motion.span translate="no" className={cn('notranslate', className)}>{text}</motion.span>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="icon-tile tone-brand mb-4 h-14 w-14 rounded-2xl [&_svg]:h-6 [&_svg]:w-6">{icon}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] text-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, className }: { message: string; className?: string }) {
  return <div className={cn('rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger', className)}>{message}</div>;
}

const accents = {
  brand: 'tone-brand',
  male: 'tone-male',
  female: 'tone-female',
  ok: 'tone-ok',
  warn: 'tone-warn',
  neutral: 'tone-neutral',
};

export function StatCard({ label, value, icon, accent = 'neutral', hint, index = 0 }: {
  label: string;
  value: number | string | undefined;
  icon: ReactNode;
  accent?: keyof typeof accents;
  hint?: ReactNode;
  index?: number;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, duration: 0.35 }} className="card p-5">
      <div className="flex items-center justify-between">
        <span className="label">{label}</span>
        <span className={cn('icon-tile h-10 w-10 rounded-xl [&_svg]:h-[19px] [&_svg]:w-[19px]', accents[accent])}>{icon}</span>
      </div>
      <div className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular notranslate">
        {value === undefined ? <Skeleton className="h-7 w-20" /> : typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
      </div>
      {hint && <div className="mt-2 text-xs text-subtle">{hint}</div>}
    </motion.div>
  );
}

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-subtle">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
