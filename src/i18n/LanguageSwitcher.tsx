import { Check, ChevronDown, Languages } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { LOCALES, LOCALE_META, useI18n, useT } from '@/i18n';

export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { locale, setLocale } = useI18n();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn('relative inline-flex', className)}>
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={t('Language')}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-2.5 text-xs font-semibold text-fg transition-colors hover:border-brand/40 focus:border-brand/60 focus:outline-none sm:px-3 sm:text-[13px]">
        <Languages className="h-4 w-4 shrink-0 text-subtle" aria-hidden />
        <span className="sm:hidden">{LOCALE_META[locale].short}</span>
        <span className="hidden sm:inline">{LOCALE_META[locale].label}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-subtle transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div role="listbox" aria-label={t('Language')}
          className="absolute right-0 top-full z-50 mt-2 min-w-[172px] overflow-hidden rounded-xl border border-line bg-surface p-1 shadow-xl">
          {LOCALES.map((l) => (
            <button key={l} type="button" role="option" aria-selected={locale === l}
              onClick={() => { setLocale(l); setOpen(false); }}
              className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-elevated',
                locale === l && 'bg-brand/10 text-brand')}>
              <span className="flex-1">{LOCALE_META[l].label}</span>
              <span className="font-mono text-[11px] text-subtle">{LOCALE_META[l].short}</span>
              {locale === l && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
