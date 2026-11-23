import { CalendarClock, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { formatDate, formatDuration, formatNumber, formatTime } from '@/lib/format';
import { shiftSeconds, shiftVisitors } from '@/lib/shifts';
import { useT } from '@/i18n/I18nProvider';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/Spinner';
import type { Shift } from '@/types/domain';

function LateNote({ shift }: { shift: Shift }) {
  const t = useT();
  const late = shift.late_male_count + shift.late_female_count;
  if (!late) return null;
  return (
    <span title={t('Offline events synced after the shift closed')} className="ml-1.5 text-xs font-normal text-brand">
      +{late} {t('late')}
    </span>
  );
}

function StatusBadge({ shift }: { shift: Shift }) {
  const t = useT();
  if (shift.status === 'active') return <Badge tone="ok" dot>{t('Active')}</Badge>;
  if (shift.end_reason === 'admin_forced') return <Badge tone="warn">{t('Closed by admin')}</Badge>;
  return <Badge>{t('Completed')}</Badge>;
}

export function ShiftsTable({ shifts, loading, showEmployee, actions, pageSize = 10 }: {
  shifts: Shift[] | undefined;
  loading?: boolean;
  showEmployee?: boolean;
  actions?: (s: Shift) => ReactNode;
  pageSize?: number;
}) {
  const t = useT();
  const num = '!text-right tabular notranslate';
  const [page, setPage] = useState(1);
  const rows = shifts ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setPage((p) => Math.min(p, totalPages));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visible = rows.slice(start, start + pageSize);

  const totals = rows.reduce((a, s) => ({
    m: a.m + s.male_count,
    f: a.f + s.female_count,
    visitors: a.visitors + shiftVisitors(s),
    seconds: a.seconds + shiftSeconds(s),
  }), { m: 0, f: 0, visitors: 0, seconds: 0 });

  const pageNumbers: (number | '…')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || Math.abs(i - safePage) <= 1) pageNumbers.push(i);
    else if (pageNumbers[pageNumbers.length - 1] !== '…') pageNumbers.push('…');
  }

  if (loading && !shifts) {
    return <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (!rows.length) {
    return <EmptyState icon={<CalendarClock className="h-5 w-5" />} title={t('No shifts found')} description={t('Shifts appear here once they are started.')} />;
  }

  return (
    <>
      <div className="divide-y sm:hidden">
        {visible.map((s, i) => (
          <div key={s.id} className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs text-subtle">
                  <span className="font-mono notranslate">#{start + i + 1}</span>
                  {showEmployee && <span className="truncate font-medium text-fg">{s.employee_name}</span>}
                </div>
                <div className="mt-0.5 text-xs text-subtle">
                  {formatDate(s.start_time)} · <span className="notranslate">{formatTime(s.start_time)} – {s.end_time ? formatTime(s.end_time) : t('Now')}</span>
                </div>
              </div>
              <StatusBadge shift={s} />
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-elevated/50 p-3 text-center">
              <div><div className="label">{t('Men')}</div><div className="mt-1 font-semibold tabular notranslate text-male">{formatNumber(s.male_count)}</div></div>
              <div><div className="label">{t('Women')}</div><div className="mt-1 font-semibold tabular notranslate text-female">{formatNumber(s.female_count)}</div></div>
              <div><div className="label">{t('Total')}</div><div className="mt-1 font-semibold tabular notranslate">{formatNumber(shiftVisitors(s))}<LateNote shift={s} /></div></div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs text-muted">
              <span className="tabular notranslate">{t('Duration')}: {formatDuration(shiftSeconds(s))}</span>
              {actions?.(s)}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-3 gap-2 bg-elevated/30 p-4 text-center text-sm font-semibold">
          <div><div className="label">{t('Men')}</div><div className="mt-1 tabular notranslate text-male">{formatNumber(totals.m)}</div></div>
          <div><div className="label">{t('Women')}</div><div className="mt-1 tabular notranslate text-female">{formatNumber(totals.f)}</div></div>
          <div><div className="label">{t('Total')}</div><div className="mt-1 text-lg tabular notranslate">{formatNumber(totals.visitors)}</div></div>
        </div>
      </div>

      <div className="scrollbar-thin hidden overflow-x-auto sm:block">
        <table className="table-base">
          <thead>
            <tr>
              <th className="w-10 text-right">#</th>
              {showEmployee && <th>{t('Employee')}</th>}
              <th>{t('Date')}</th>
              <th>{t('Time')}</th>
              <th className="!text-left">{t('Duration')}</th>
              <th className={num}>{t('Men')}</th>
              <th className={num}>{t('Women')}</th>
              <th className={num}>{t('Total')}</th>
              <th>{t('Status')}</th>
              {actions && <th />}
            </tr>
          </thead>
          <tbody>
            {visible.map((s, i) => (
              <tr key={s.id}>
                <td className="text-right font-mono text-xs text-subtle">{start + i + 1}</td>
                {showEmployee && <td className="font-medium">{s.employee_name}</td>}
                <td>{formatDate(s.start_time)}</td>
                <td className="tabular notranslate text-muted">{formatTime(s.start_time)} – {s.end_time ? formatTime(s.end_time) : t('Now')}</td>
                <td className="!text-left tabular notranslate text-muted">{formatDuration(shiftSeconds(s))}</td>
                <td className={`${num} text-male`}>{formatNumber(s.male_count)}</td>
                <td className={`${num} text-female`}>{formatNumber(s.female_count)}</td>
                <td className={`${num} font-semibold`}>
                  {formatNumber(shiftVisitors(s))}
                  <LateNote shift={s} />
                </td>
                <td><StatusBadge shift={s} /></td>
                {actions && <td className="text-right">{actions(s)}</td>}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-elevated/30 font-semibold">
            <tr>
              <td className="!text-right font-mono text-xs text-subtle">—</td>
              <td colSpan={showEmployee ? 3 : 2} className="py-3" />
              <td className="py-3 !text-left">
                <div className="label">{t('Duration')}</div>
                <div className={`mt-1 tabular notranslate`}>{formatDuration(totals.seconds)}</div>
              </td>
              <td className={`py-3 ${num}`}>
                <div className="label">{t('Men')}</div>
                <div className="mt-1 text-male">{formatNumber(totals.m)}</div>
              </td>
              <td className={`py-3 ${num}`}>
                <div className="label">{t('Women')}</div>
                <div className="mt-1 text-female">{formatNumber(totals.f)}</div>
              </td>
              <td className={`py-3 ${num}`}>
                <div className="label">{t('Total')}</div>
                <div className="mt-1 text-lg">{formatNumber(totals.visitors)}</div>
              </td>
              <td />
              {actions && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex flex-col items-center gap-3 border-t px-4 py-3 sm:flex-row sm:justify-between sm:px-5">
          <span className="text-xs text-subtle">{t('Page {page} of {pages}', { page: safePage, pages: totalPages })}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="secondary" icon={<ChevronLeft className="h-4 w-4" />} aria-label={t('Previous page')}
              disabled={safePage === 1} onClick={() => setPage(safePage - 1)} />
            {pageNumbers.map((p, i) => typeof p === 'number' ? (
              <Button key={p} size="sm" variant={p === safePage ? 'primary' : 'ghost'} onClick={() => setPage(p)} aria-current={p === safePage ? 'page' : undefined}>
                {p}
              </Button>
            ) : (
              <span key={`gap-${i}`} className="px-1 text-xs text-subtle">…</span>
            ))}
            <Button size="sm" variant="secondary" icon={<ChevronRight className="h-4 w-4" />} aria-label={t('Next page')}
              disabled={safePage === totalPages} onClick={() => setPage(safePage + 1)} />
          </div>
        </div>
      )}
    </>
  );
}
