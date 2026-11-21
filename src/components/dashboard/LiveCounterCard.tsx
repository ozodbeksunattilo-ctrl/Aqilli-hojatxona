import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { AnimatedNumber } from '@/components/ui/misc';
import type { Gender } from '@/types/domain';

function GenderGlyph({ gender, className }: { gender: Gender; className?: string }) {
  return gender === 'male' ? (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor"><circle cx="12" cy="4" r="2.2" /><path d="M9 8h6a1.5 1.5 0 0 1 1.5 1.5V15H15v7h-2v-6h-2v6H9v-7H7.5V9.5A1.5 1.5 0 0 1 9 8Z" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor"><circle cx="12" cy="4" r="2.2" /><path d="M10.2 8h3.6a1.5 1.5 0 0 1 1.45 1.12L17 16h-2.5v6h-2v-5h-1v5h-2v-6H7l1.75-6.88A1.5 1.5 0 0 1 10.2 8Z" /></svg>
  );
}

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
    <div className="card relative overflow-hidden p-6">
      <div className={cn('pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full blur-3xl', male ? 'bg-male/10' : 'bg-female/10')} />
      <AnimatePresence>
        {bumps.length > 0 && (
          <motion.div key={bumps[bumps.length - 1]} className={cn('pointer-events-none absolute inset-0 rounded-2xl ring-2', male ? 'ring-male/50' : 'ring-female/50')}
            initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 1 }} />
        )}
      </AnimatePresence>

      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('grid h-11 w-11 place-items-center rounded-2xl', male ? 'bg-male/10' : 'bg-female/10', accent)}>
            <GenderGlyph gender={gender} className="h-6 w-6" />
          </div>
          <div>
            <div className="text-[15px] font-semibold tracking-tight">{male ? "Men's restroom" : "Women's restroom"}</div>
            <div className="text-xs text-subtle"><span translate="no" className="notranslate font-mono">{male ? 'MEN-001' : 'WOMEN-001'}</span> · tripod turnstile</div>
          </div>
        </div>
        {deviceOnline !== null && (
          <span className={cn('flex items-center gap-1.5 text-xs', deviceOnline ? 'text-ok' : 'text-danger')}>
            <span className={cn('h-1.5 w-1.5 rounded-full', deviceOnline ? 'bg-ok' : 'bg-danger')} />
            {deviceOnline ? 'Online' : 'Offline'}
          </span>
        )}
      </div>

      <div className="relative mt-8">
        <div className="label">Current shift</div>
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
        {!active && <div className="mt-2 text-xs text-subtle">No active shift — start a shift to begin counting.</div>}
      </div>

      <div className="relative mt-6 flex items-center justify-between border-t pt-4 text-sm">
        <span className="text-subtle">Today (all shifts)</span>
        <span className="font-semibold tabular notranslate">{todayCount === undefined ? '—' : formatNumber(todayCount)}</span>
      </div>
    </div>
  );
}
