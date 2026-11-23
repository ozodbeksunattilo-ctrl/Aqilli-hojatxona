import { cn } from '@/lib/cn';
import { useT } from '@/i18n/I18nProvider';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('relative grid h-9 w-9 shrink-0 place-items-center rounded-[14px] bg-gradient-to-br from-brand via-[#6d5cf7] to-[#3f2fc0] text-white shadow-[0_6px_18px_-6px_rgb(var(--brand)/0.75)] ring-1 ring-white/20', className)}>
      <span className="absolute inset-[1px] rounded-[13px] bg-gradient-to-b from-white/15 to-transparent" />
      <svg viewBox="0 0 24 24" className="relative h-[62%] w-[62%]" fill="currentColor" aria-hidden="true">
        <circle cx="6.5" cy="4.2" r="2.1" />
        <rect x="3.9" y="7.4" width="5.2" height="7.6" rx="1.7" />
        <rect x="4.4" y="13" width="1.7" height="7.6" rx="0.85" />
        <rect x="6.9" y="13" width="1.7" height="7.6" rx="0.85" />
        <rect x="11.35" y="4" width="1.3" height="16.5" rx="0.65" opacity="0.45" />
        <circle cx="17.5" cy="4.2" r="2.1" />
        <path d="M16 7.4h3a1.5 1.5 0 0 1 1.44 1.08L22.3 15H12.7l1.86-6.52A1.5 1.5 0 0 1 16 7.4Z" />
        <rect x="15.4" y="14" width="1.6" height="6.6" rx="0.8" />
        <rect x="18" y="14" width="1.6" height="6.6" rx="0.8" />
      </svg>
    </div>
  );
}

export function Wordmark({ sub }: { sub?: string }) {
  const t = useT();
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Logo className="h-10 w-10" />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[15px] font-semibold tracking-tight">{t('Smart Restroom')}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-subtle">{sub}</div>}
      </div>
    </div>
  );
}
