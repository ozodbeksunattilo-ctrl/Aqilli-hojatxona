import { CalendarCheck, Clock, Users } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { backend } from '@/services';
import { useAsync } from '@/hooks/useAsync';
import { formatDuration } from '@/lib/format';
import { Card } from '@/components/ui/Card';
import { ErrorNote, PageHeader, StatCard } from '@/components/ui/misc';
import { ShiftsTable } from '@/components/dashboard/ShiftsTable';

export function MyShifts() {
  const { profile } = useAuth();
  const { data, loading, error } = useAsync(
    () => backend.listShifts({ employeeId: profile!.id, limit: 300 }),
    [profile?.id],
    { live: ['shifts'] },
  );
  const done = data?.filter((s) => s.status === 'completed') ?? [];
  const visitors = done.reduce((n, s) => n + s.total_count, 0);
  const seconds = done.reduce((n, s) => n + (s.duration_seconds ?? 0), 0);

  return (
    <div>
      <PageHeader title="My shifts" description="Your complete shift history. Completed shifts are permanent and cannot be edited." />
      {error && <ErrorNote message={error} className="mb-4" />}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Completed shifts" value={data ? done.length : undefined} icon={<CalendarCheck className="h-4 w-4" />} accent="brand" />
        <StatCard label="Visitors served" value={data ? visitors : undefined} icon={<Users className="h-4 w-4" />} accent="ok" index={1} />
        <StatCard label="Hours worked" value={data ? formatDuration(seconds) : undefined} icon={<Clock className="h-4 w-4" />} index={2} />
      </div>
      <Card className="overflow-hidden">
        <ShiftsTable shifts={data} loading={loading} />
      </Card>
    </div>
  );
}
