import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'danger' | 'male' | 'female';

const tones: Record<Tone, string> = {
  neutral: 'bg-elevated text-muted border-line',
  brand: 'bg-brand/10 text-brand border-brand/20',
  ok: 'bg-ok/10 text-ok border-ok/20',
  warn: 'bg-warn/10 text-warn border-warn/25',
  danger: 'bg-danger/10 text-danger border-danger/20',
  male: 'bg-male/10 text-male border-male/20',
  female: 'bg-female/10 text-female border-female/20',
};

export function Badge({ tone = 'neutral', dot, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function LiveDot({ tone = 'ok', className }: { tone?: 'ok' | 'danger' | 'warn'; className?: string }) {
  const color = { ok: 'bg-ok', danger: 'bg-danger', warn: 'bg-warn' }[tone];
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)}>
      {tone === 'ok' && <span className={cn('absolute inline-flex h-full w-full animate-pulseRing rounded-full', color)} />}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', color)} />
    </span>
  );
}
