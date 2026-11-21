import { AnimatePresence, motion } from 'framer-motion';
import { Radio } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatTimeSec, relativeTime } from '@/lib/format';
import { useNow } from '@/hooks/useNow';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/Spinner';
import type { EntryEvent } from '@/types/domain';

export function EventFeed({ events, loading, className }: { events: EntryEvent[] | undefined; loading?: boolean; className?: string }) {
  useNow(10_000); // keep relative times fresh
  if (loading && !events) {
    return (
      <div className={cn('space-y-3', className)}>
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-11" />)}
      </div>
    );
  }
  if (!events?.length) {
    return <EmptyState icon={<Radio className="h-5 w-5" />} title="Waiting for visitors" description="Confirmed turnstile passages appear here in real time." />;
  }
  return (
    <ul className={cn('scrollbar-thin -mx-2 max-h-[420px] overflow-y-auto', className)}>
      <AnimatePresence initial={false}>
        {events.map((e) => (
          <motion.li key={e.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            className="relative flex items-center gap-3 rounded-xl px-2 py-2.5">
            {/* New-arrival highlight: fades out via opacity (CSS-variable colours are not animatable). */}
            <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl bg-brand/10"
              initial={{ opacity: 1 }} animate={{ opacity: 0 }} transition={{ duration: 1.4 }} />
            <span translate="no" className={cn('notranslate relative grid h-8 w-8 shrink-0 place-items-center rounded-lg text-xs font-semibold',
              e.gender === 'male' ? 'bg-male/10 text-male' : 'bg-female/10 text-female')}>
              {e.gender === 'male' ? 'M' : 'W'}
            </span>
            <div className="relative min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                {e.gender === 'male' ? 'Male visitor' : 'Female visitor'}
                {e.source === 'simulated' && <Badge tone="warn">simulated</Badge>}
                {e.attribution === 'late' && <Badge tone="brand">synced late</Badge>}
                {e.attribution === 'unassigned' && <Badge tone="danger">no shift</Badge>}
              </div>
              <div className="truncate font-mono notranslate text-[11px] text-subtle">{e.device_id} · {e.event_id}</div>
            </div>
            <div className="relative text-right">
              <div className="text-xs font-medium tabular notranslate">{formatTimeSec(e.occurred_at)}</div>
              <div className="text-[11px] text-subtle">{relativeTime(e.created_at)}</div>
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
