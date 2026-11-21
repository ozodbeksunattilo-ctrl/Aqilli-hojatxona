import { CalendarClock } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatDate, formatDuration, formatNumber, formatTime, secondsBetween } from '@/lib/format';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/Spinner';
import type { Shift } from '@/types/domain';

export function ShiftsTable({ shifts, loading, showEmployee, actions }: {
  shifts: Shift[] | undefined;
  loading?: boolean;
  showEmployee?: boolean;
  actions?: (s: Shift) => ReactNode;
}) {
  if (loading && !shifts) {
    return <div className="space-y-2 p-5">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (!shifts?.length) {
    return <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No shifts found" description="Shifts appear here once they are started." />;
  }
  return (
    <div className="scrollbar-thin overflow-x-auto">
      <table className="table-base">
        <thead>
          <tr>
            {showEmployee && <th>Employee</th>}
            <th>Date</th>
            <th>Time</th>
            <th>Duration</th>
            <th className="text-right">Men</th>
            <th className="text-right">Women</th>
            <th className="text-right">Total</th>
            <th>Status</th>
            {actions && <th />}
          </tr>
        </thead>
        <tbody>
          {shifts.map((s) => {
            const late = s.late_male_count + s.late_female_count;
            return (
              <tr key={s.id}>
                {showEmployee && <td className="font-medium">{s.employee_name}</td>}
                <td>{formatDate(s.start_time)}</td>
                <td className="tabular notranslate text-muted">{formatTime(s.start_time)} – {s.end_time ? formatTime(s.end_time) : 'now'}</td>
                <td className="tabular notranslate text-muted">{formatDuration(s.duration_seconds ?? secondsBetween(s.start_time))}</td>
                <td className="text-right tabular notranslate text-male">{formatNumber(s.male_count)}</td>
                <td className="text-right tabular notranslate text-female">{formatNumber(s.female_count)}</td>
                <td className="text-right font-semibold tabular notranslate">
                  {formatNumber(s.total_count)}
                  {late > 0 && <span title="Offline events synced after the shift closed" className="ml-1.5 text-xs font-normal text-brand">+{late} late</span>}
                </td>
                <td>
                  {s.status === 'active' ? <Badge tone="ok" dot>Active</Badge>
                    : s.end_reason === 'admin_forced' ? <Badge tone="warn">Closed by admin</Badge>
                    : <Badge>Completed</Badge>}
                </td>
                {actions && <td className="text-right">{actions(s)}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
