import { cn } from '@/lib/cn';

export const Spinner = ({ className }: { className?: string }) => (
  <svg className={cn('h-5 w-5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.5" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
  </svg>
);

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('relative overflow-hidden rounded-lg bg-elevated', className)}>
    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-fg/[0.05] to-transparent" />
  </div>
);
