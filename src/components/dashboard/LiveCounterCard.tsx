import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDate, formatNumber } from '@/lib/format';
import { useT } from '@/i18n/I18nProvider';
import { AnimatedNumber } from '@/components/ui/misc';
import { GenderFigure } from '@/components/ui/GenderFigure';
import type { Gender } from '@/types/domain';

/**
 * Big live counter for one restroom. Values come from the server; the card
 * only animates the change and flashes "+1" when a passage is confirmed.
 */
export function LiveCounterCard({ gender, shiftCount, todayCount, active, deviceOnline }: {
  gender: Gender;
  shiftCount: number | undefined;
  todayCount: number | undefined;
  active: boolean;
  deviceOnline: boolean | null;
}) {
  const t = useT();
  const prev = useRef(shiftCount);
  const [bumps, setBumps] = useState<number[]>([]);
  useEffect(() => {
    if (prev.current !== undefined && shiftCount !== undefined && shiftCount > prev.current) {
      const id = Date.now();
      setBumps((b) => [...b.slice(-2), id]);
      setTimeout(() => setBumps((b) => b.filter((x) => x !== id)), 1100);
    }
    prev.current = shiftCount;
  }, [shiftCount]);

  const male = gender === 'male';
  const accent = male ? 'text-male' : 'text-female';
  return (
    <div className="card relative flex flex-col overflow-hidden p-6">
      <div className={cn('pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl', male ? 'bg-male/10' : 'bg-female/10')} />
      <AnimatePresence>
        {bumps.length > 0 && (
          <motion.div key={bumps[bumps.length - 1]} className={cn('pointer-events-none absolute inset-0 rounded-2xl ring-2', male ? 'ring-male/50' : 'ring-female/50')}
            initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} />
        )}
      </AnimatePresence>

      <div className="relative flex min-h-[44px] items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('icon-tile h-12 w-12 rounded-2xl', male ? 'tone-male' : 'tone-female')}>
            <GenderFigure gender={gender} className="h-[26px] w-[26px] drop-shadow-[0_1px_6px_rgb(var(--tone)/0.5)]" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">{male ? t("Men's restroom") : t("Women's restroom")}</div>
            <div className="text-xs text-subtle notranslate">{formatDate(new Date().toISOString())}</div>
          </div>
        </div>
        {deviceOnline !== null && (
          <span className={cn('flex items-center gap-1.5 text-xs', deviceOnline ? 'text-ok' : 'text-danger')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', deviceOnline ? 'bg-ok' : 'bg-danger')} />
            {deviceOnline ? t('Online') : t('Offline')}
          </span>
        )}
      </div>

      <div className="relative mt-8 min-h-[116px]">
        <div className="label">{t('Current shift')}</div>
        <div className="relative mt-2 flex items-baseline gap-3">
          <span className={cn('text-[64px] font-semibold leading-none tracking-[-0.04em] tabular notranslate sm:text-[72px]', active ? 'text-fg' : 'text-subtle')}>
            {shiftCount === undefined ? '—' : <AnimatedNumber value={shiftCount} />}
          </span>
          <AnimatePresence>
            {bumps.map((id) => (
              <motion.span key={id} className={cn('absolute left-full top-0 ml-2 text-xl font-semibold', accent)}
                initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: -14 }} exit={{ opacity: 0, y: -28 }} transition={{ duration: 0.6 }}>
                +1
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
        {!active && <div className="mt-2 text-xs text-subtle">{t('No active shift — start a shift to begin counting.')}</div>}
      </div>

      <div className="relative mt-auto pt-6">
        <div className="flex items-center justify-between border-t pt-4 text-sm">
          <span className="text-subtle">{t('Today (all shifts)')}</span>
          <span className="font-semibold tabular notranslate">{todayCount === undefined ? '—' : formatNumber(todayCount)}</span>
        </div>
      </div>
    </div>
  );
}
